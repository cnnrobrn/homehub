/**
 * `sync-gcal` handler.
 *
 * Consumes pgmq messages from the per-provider queues:
 *   - `sync_full:gcal`  — initial sync: last 90d + next 365d of events.
 *   - `sync_delta:gcal` — incremental sync using the stored sync token.
 *
 * Contract per message envelope: `entity_id` carries the
 * `sync.provider_connection.id`; the worker resolves the household +
 * member from that row on every run so stale envelopes cannot be
 * replayed against a moved / revoked connection.
 *
 * Error policy:
 *   - `FullResyncRequiredError` → the stored sync token is dead. Clear
 *     the cursor and requeue as `sync_full:gcal`. The current message
 *     is ack'd so pgmq doesn't double-process.
 *   - `RateLimitError`          → `nack` with a visibility bump matching
 *     the provider's Retry-After. pgmq redelivers after the window.
 *   - Any other error           → insert into `sync.dead_letter` with
 *     the full envelope + reason and `ack` so the queue moves on.
 *
 * Idempotency: upserts key on `(household_id, provider, source_id)` per
 * the partial unique index on `app.event`. Re-running a sync is safe.
 *
 * `app.event.segment` is set to `'system'` on sync; the enrichment
 * worker reclassifies (`financial`, `food`, `fun`, `social`) during M3.
 */

import { type Database, type Json } from '@homehub/db';
import {
  type CalendarEvent,
  type CalendarProvider,
  FullResyncRequiredError,
  RateLimitError,
} from '@homehub/providers-calendar';
import {
  type Logger,
  type MessageEnvelope,
  type QueueClient,
  queueNames,
} from '@homehub/worker-runtime';
import { type SupabaseClient } from '@supabase/supabase-js';

/** 90 days back, 365 days forward. Matches `google-workspace.md`. */
const FULL_SYNC_PAST_DAYS = 90;
const FULL_SYNC_FUTURE_DAYS = 365;

/** Cursor kind values we store in `sync.cursor`. */
export const CURSOR_KIND = {
  syncToken: 'gcal.sync_token',
  channel: 'gcal.channel',
} as const;

/** Fixed provider string we record on `app.event.provider`. */
export const EVENT_PROVIDER = 'gcal';

export interface GcalSyncHandlerDeps {
  supabase: SupabaseClient<Database>;
  queues: QueueClient;
  calendar: CalendarProvider;
  log: Logger;
  /** Injectable for tests; defaults to `Date.now`. */
  now?: () => Date;
}

export type SyncMode = 'full' | 'delta';

interface ConnectionRow {
  id: string;
  household_id: string;
  member_id: string | null;
  provider: string;
  nango_connection_id: string;
  status: string;
}

interface CursorRow {
  kind: string;
  value: string | null;
}

/** Canonical envelope payload for sync messages. */
export interface SyncMessagePayload extends MessageEnvelope {
  kind: 'sync.gcal.full' | 'sync.gcal.delta';
}

/**
 * Top-level: claim → dispatch → handle errors → ack / nack / dead-letter.
 * Returns `true` if a message was processed (irrespective of success) so
 * the main loop can decide whether to back off.
 */
export async function pollOnce(deps: GcalSyncHandlerDeps): Promise<'claimed' | 'idle'> {
  const fullQueue = queueNames.syncFull('gcal');
  const deltaQueue = queueNames.syncDelta('gcal');

  // Try full-sync first so freshly-connected households complete their
  // initial backfill before a delta can race ahead of them.
  for (const [queue, mode] of [
    [fullQueue, 'full'],
    [deltaQueue, 'delta'],
  ] as const) {
    const claimed = await deps.queues.claim(queue);
    if (!claimed) continue;

    const log = deps.log.child({
      queue,
      message_id: claimed.messageId,
      household_id: claimed.payload.household_id,
      entity_id: claimed.payload.entity_id,
      mode,
    });

    try {
      await runSync(
        { ...deps, log },
        {
          mode,
          connectionId: claimed.payload.entity_id,
          envelope: claimed.payload,
        },
      );
      await deps.queues.ack(queue, claimed.messageId);
      return 'claimed';
    } catch (err) {
      if (err instanceof FullResyncRequiredError) {
        log.warn('sync token invalidated; requeueing as full sync');
        try {
          await clearSyncToken({ ...deps, log }, claimed.payload.entity_id);
          await deps.queues.send(fullQueue, {
            ...claimed.payload,
            kind: 'sync.gcal.full',
          });
          await deps.queues.ack(queue, claimed.messageId);
        } catch (inner) {
          log.error('failed to requeue after FullResyncRequiredError', {
            error: inner instanceof Error ? inner.message : String(inner),
          });
          await deps.queues.deadLetter(
            queue,
            claimed.messageId,
            'full-resync-required; requeue failed',
            claimed.payload,
          );
          await deps.queues.ack(queue, claimed.messageId);
        }
        return 'claimed';
      }

      if (err instanceof RateLimitError) {
        log.warn('google rate limit; nacking with visibility bump', {
          retry_after_seconds: err.retryAfterSeconds,
        });
        await deps.queues.nack(queue, claimed.messageId, {
          retryDelaySec: err.retryAfterSeconds,
        });
        return 'claimed';
      }

      const reason = err instanceof Error ? err.message : String(err);
      log.error('sync-gcal handler failed; dead-lettering', { error: reason });
      await deps.queues.deadLetter(queue, claimed.messageId, reason, claimed.payload);
      await deps.queues.ack(queue, claimed.messageId);
      return 'claimed';
    }
  }

  return 'idle';
}

interface RunSyncArgs {
  mode: SyncMode;
  connectionId: string;
  envelope: MessageEnvelope;
}

async function runSync(deps: GcalSyncHandlerDeps, args: RunSyncArgs): Promise<void> {
  const { supabase, calendar, log } = deps;
  const now = (deps.now ?? (() => new Date()))();

  const connection = await loadConnection(supabase, args.connectionId);
  if (!connection) {
    throw new Error(`connection not found: ${args.connectionId}`);
  }
  if (connection.provider !== EVENT_PROVIDER) {
    throw new Error(
      `connection ${connection.id} is provider=${connection.provider}, expected ${EVENT_PROVIDER}`,
    );
  }
  if (connection.status === 'revoked') {
    throw new Error(`connection ${connection.id} is revoked`);
  }

  log.info('sync starting', { nango_connection_id: connection.nango_connection_id });

  // Resolve the stored sync token (delta only) and time bounds (full only).
  const existingSyncToken =
    args.mode === 'delta'
      ? await getCursorValue(supabase, connection.id, CURSOR_KIND.syncToken)
      : undefined;
  const timeMin = new Date(now.getTime() - FULL_SYNC_PAST_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(
    now.getTime() + FULL_SYNC_FUTURE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  let upsertedCount = 0;
  let nextSyncToken: string | undefined;

  for await (const page of calendar.listEvents({
    connectionId: connection.nango_connection_id,
    timeMin,
    timeMax,
    ...(existingSyncToken ? { syncToken: existingSyncToken } : {}),
  })) {
    if (page.events.length === 0 && !page.nextSyncToken) {
      // Empty terminal page without a sync token — nothing to do.
      continue;
    }

    const rowsInserted = await upsertEventsPage(supabase, connection, page.events, now);
    upsertedCount += rowsInserted.length;

    // Enqueue enrichment for each row touched. One message per event.
    if (rowsInserted.length > 0) {
      await enqueueEnrichment(deps.queues, connection.household_id, rowsInserted, now);
    }

    if (page.nextSyncToken) nextSyncToken = page.nextSyncToken;
  }

  // Persist the sync token as the new cursor value.
  if (nextSyncToken) {
    await upsertCursor(supabase, connection.id, CURSOR_KIND.syncToken, nextSyncToken);
  }

  // Update connection's last_synced_at and write an audit row so the UI
  // can show "last synced 3m ago" and operators can trace activity.
  await supabase
    .schema('sync')
    .from('provider_connection')
    .update({ last_synced_at: now.toISOString(), status: 'active' })
    .eq('id', connection.id);

  await writeAudit(supabase, {
    household_id: connection.household_id,
    action: `sync.gcal.${args.mode}.completed`,
    resource_id: connection.id,
    after: { upserted_events: upsertedCount, next_sync_token_written: Boolean(nextSyncToken) },
  });

  log.info('sync completed', { upserted_count: upsertedCount });
}

// ---- Supabase helpers --------------------------------------------------

async function loadConnection(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<ConnectionRow | null> {
  const { data, error } = await supabase
    .schema('sync')
    .from('provider_connection')
    .select('id, household_id, member_id, provider, nango_connection_id, status')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`provider_connection lookup failed: ${error.message}`);
  return data;
}

async function getCursorValue(
  supabase: SupabaseClient<Database>,
  connectionId: string,
  kind: string,
): Promise<string | undefined> {
  const { data, error } = await supabase
    .schema('sync')
    .from('cursor')
    .select('kind, value')
    .eq('connection_id', connectionId)
    .eq('kind', kind)
    .maybeSingle<CursorRow>();
  if (error) throw new Error(`cursor lookup failed: ${error.message}`);
  return data?.value ?? undefined;
}

async function clearSyncToken(deps: GcalSyncHandlerDeps, connectionId: string): Promise<void> {
  const { error } = await deps.supabase
    .schema('sync')
    .from('cursor')
    .delete()
    .eq('connection_id', connectionId)
    .eq('kind', CURSOR_KIND.syncToken);
  if (error) throw new Error(`cursor clear failed: ${error.message}`);
}

async function upsertCursor(
  supabase: SupabaseClient<Database>,
  connectionId: string,
  kind: string,
  value: string,
): Promise<void> {
  const { error } = await supabase
    .schema('sync')
    .from('cursor')
    .upsert(
      { connection_id: connectionId, kind, value, updated_at: new Date().toISOString() },
      { onConflict: 'connection_id,kind' },
    );
  if (error) throw new Error(`cursor upsert failed: ${error.message}`);
}

interface UpsertedEventSummary {
  id: string;
  source_id: string;
}

async function upsertEventsPage(
  supabase: SupabaseClient<Database>,
  connection: ConnectionRow,
  events: CalendarEvent[],
  now: Date,
): Promise<UpsertedEventSummary[]> {
  if (events.length === 0) return [];
  const rows = events.map((ev) => ({
    household_id: connection.household_id,
    owner_member_id: connection.member_id,
    // Spec: segment starts as 'system'. Enrichment reclassifies.
    segment: 'system',
    // `kind` is our own taxonomy; 'calendar.event' works for v1.
    kind: 'calendar.event',
    title: ev.title,
    starts_at: ev.startsAt,
    ends_at: ev.endsAt ?? null,
    all_day: ev.allDay,
    location: ev.location ?? null,
    source_id: ev.sourceId,
    source_version: ev.sourceVersion,
    provider: EVENT_PROVIDER,
    metadata: {
      ...ev.metadata,
      owner_email: ev.ownerEmail,
      attendees: ev.attendees,
      status: ev.status,
      ...(ev.description ? { description: ev.description } : {}),
      ...(ev.recurringEventId ? { recurring_event_id: ev.recurringEventId } : {}),
    } as unknown as Json,
    updated_at: now.toISOString(),
  }));

  const { data, error } = await supabase
    .schema('app')
    .from('event')
    .upsert(rows, { onConflict: 'household_id,provider,source_id' })
    .select('id, source_id');
  if (error) throw new Error(`app.event upsert failed: ${error.message}`);
  return (data ?? []) as UpsertedEventSummary[];
}

async function enqueueEnrichment(
  queues: QueueClient,
  householdId: string,
  events: UpsertedEventSummary[],
  now: Date,
): Promise<void> {
  const envelopes: MessageEnvelope[] = events.map((ev) => ({
    household_id: householdId,
    kind: 'enrich.event',
    entity_id: ev.id,
    version: 1,
    enqueued_at: now.toISOString(),
  }));
  await queues.sendBatch(queueNames.enrichEvent, envelopes);
}

async function writeAudit(
  supabase: SupabaseClient<Database>,
  input: {
    household_id: string;
    action: string;
    resource_id: string;
    after: unknown;
  },
): Promise<void> {
  // Best-effort: audit failures must not fail the business operation.
  const { error } = await supabase
    .schema('audit')
    .from('event')
    .insert({
      household_id: input.household_id,
      actor_user_id: null,
      action: input.action,
      resource_type: 'sync.provider_connection',
      resource_id: input.resource_id,
      before: null,
      after: input.after as Json,
    });
  if (error) {
    // Intentionally not thrown — see function comment.
    console.warn(`[sync-gcal] audit write failed: ${error.message}`);
  }
}
