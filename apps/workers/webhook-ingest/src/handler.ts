/**
 * `webhook-ingest` HTTP handler logic.
 *
 * This service is the single public HTTP ingress for every provider
 * webhook HomeHub integrates with. It terminates TLS at Railway's edge,
 * verifies the provider signature, and enqueues a fan-out message for
 * the matching `sync-*` worker.
 *
 * Two routes today (M2-A):
 *
 *   POST /webhooks/google-calendar
 *     - Google push notifications do NOT use HMAC. They identify the
 *       target with `X-Goog-Channel-ID` + `X-Goog-Resource-ID` headers.
 *       We look up the channel in `sync.cursor` (kind='gcal.channel'),
 *       resolve the connection, enqueue `sync_delta:gcal`, 204.
 *     - Unknown channel → 404. Malformed headers → 400.
 *
 *   POST /webhooks/nango
 *     - Nango signs the body with `X-Nango-Signature` (HMAC-SHA256,
 *       hex). We verify against `NANGO_WEBHOOK_SECRET`.
 *     - `connection.created` with `provider=google-calendar`:
 *         1. Insert `sync.provider_connection` (idempotent upsert).
 *         2. Call `gcal.watch()` to subscribe to push notifications.
 *         3. Store the channel as a `sync.cursor` row kind='gcal.channel'.
 *         4. Enqueue `sync_full:gcal`.
 *     - `connection.deleted`: mark revoked, unwatch, clear cursors.
 *
 * Both routes return JSON; the router never leaks the request body back
 * to the caller.
 */

import { type Database, type Json } from '@homehub/db';
import { type CalendarProvider } from '@homehub/providers-calendar';
import { type Logger, type QueueClient, queueNames } from '@homehub/worker-runtime';
import { type SupabaseClient } from '@supabase/supabase-js';

import { verifyHmac } from './hmac.js';

export const GCAL_CHANNEL_KIND = 'gcal.channel';
export const GCAL_SYNC_TOKEN_KIND = 'gcal.sync_token';
export const GCAL_PROVIDER_KEY = 'google-calendar';
export const GCAL_PROVIDER = 'gcal';

// We pack both identifiers into the `sync.cursor.value` text column as
// JSON: `{"resource_id":"...", "expiration":"..."}`. The connection is
// the FK; no extra columns required.
export interface GcalChannelValue {
  resource_id: string;
  expiration: string;
}

export interface WebhookIngestDeps {
  supabase: SupabaseClient<Database>;
  queues: QueueClient;
  calendar: CalendarProvider;
  log: Logger;
  env: {
    NANGO_WEBHOOK_SECRET?: string;
    WEBHOOK_PUBLIC_URL?: string;
  };
  /** Injectable for tests. */
  now?: () => Date;
  /** Used only by the Nango webhook. Keep the default for prod. */
  channelIdFactory?: () => string;
}

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

export interface HandleGoogleCalendarArgs {
  headers: Readonly<Record<string, string | string[] | undefined>>;
}

// ---- Route: POST /webhooks/google-calendar -----------------------------

export async function handleGoogleCalendarWebhook(
  deps: WebhookIngestDeps,
  args: HandleGoogleCalendarArgs,
): Promise<WebhookResult> {
  const channelId = headerAsString(args.headers['x-goog-channel-id']);
  const resourceId = headerAsString(args.headers['x-goog-resource-id']);
  const resourceState = headerAsString(args.headers['x-goog-resource-state']);

  if (!channelId || !resourceId) {
    deps.log.warn('gcal webhook missing required headers', {
      has_channel_id: Boolean(channelId),
      has_resource_id: Boolean(resourceId),
    });
    return { status: 400, body: { error: 'missing required x-goog-* headers' } };
  }

  // Google sends a `sync` message immediately after `events.watch`. It
  // carries no diff; ignore the body entirely. Resource state values:
  // 'sync' (initial), 'exists' (change), 'not_exists' (deleted).
  if (resourceState === 'sync') {
    deps.log.info('gcal channel sync notification received', { channel_id: channelId });
    return { status: 204, body: {} };
  }

  // Look up the HomeHub channel in `sync.cursor`. We also filter on kind
  // so an accidentally-named unrelated cursor can't match.
  const { data: cursors, error } = await deps.supabase
    .schema('sync')
    .from('cursor')
    .select('connection_id, value, kind')
    .eq('kind', GCAL_CHANNEL_KIND);
  if (error) {
    throw new Error(`cursor lookup failed: ${error.message}`);
  }

  // `channelId` is stored as the `sync.cursor` row's natural key — but
  // cursor rows key on `(connection_id, kind)`, not on channel id. We
  // pack `{ resource_id, expiration, channel_id }` into the value and
  // scan. For v1 this is fine; scale path is a dedicated column.
  const match = (cursors ?? []).find((row) => {
    const parsed = parseChannelValue(row.value);
    return parsed?.channel_id === channelId;
  });

  if (!match) {
    deps.log.warn('gcal webhook for unknown channel; dropping', {
      channel_id: channelId,
      resource_id: resourceId,
    });
    return { status: 404, body: { error: 'unknown channel' } };
  }

  // Resolve the connection row to get the household id for the envelope.
  const { data: connection, error: connErr } = await deps.supabase
    .schema('sync')
    .from('provider_connection')
    .select('id, household_id, status')
    .eq('id', match.connection_id)
    .maybeSingle();
  if (connErr) throw new Error(`provider_connection lookup failed: ${connErr.message}`);
  if (!connection) {
    deps.log.warn('gcal channel cursor orphaned from connection; dropping', {
      channel_id: channelId,
      connection_id: match.connection_id,
    });
    return { status: 404, body: { error: 'connection not found' } };
  }

  if (connection.status === 'revoked') {
    deps.log.info('gcal webhook received for revoked connection; ignoring', {
      connection_id: connection.id,
    });
    return { status: 204, body: {} };
  }

  const now = (deps.now ?? (() => new Date()))();
  await deps.queues.send(queueNames.syncDelta(GCAL_PROVIDER), {
    household_id: connection.household_id,
    kind: 'sync.gcal.delta',
    entity_id: connection.id,
    version: 1,
    enqueued_at: now.toISOString(),
  });
  deps.log.info('gcal delta sync enqueued', {
    channel_id: channelId,
    connection_id: connection.id,
  });
  return { status: 204, body: {} };
}

// ---- Route: POST /webhooks/nango ---------------------------------------

export interface HandleNangoArgs {
  headers: Readonly<Record<string, string | string[] | undefined>>;
  rawBody: Buffer;
}

export async function handleNangoWebhook(
  deps: WebhookIngestDeps,
  args: HandleNangoArgs,
): Promise<WebhookResult> {
  const signature = headerAsString(args.headers['x-nango-signature']);
  if (!signature) {
    return { status: 400, body: { error: 'missing x-nango-signature header' } };
  }
  if (!deps.env.NANGO_WEBHOOK_SECRET) {
    deps.log.error('NANGO_WEBHOOK_SECRET not configured; rejecting webhook');
    return { status: 500, body: { error: 'webhook secret not configured' } };
  }

  const ok = verifyHmac({
    rawBody: args.rawBody,
    signature,
    secret: deps.env.NANGO_WEBHOOK_SECRET,
    encoding: 'hex',
  });
  if (!ok) {
    deps.log.warn('nango webhook signature mismatch');
    return { status: 401, body: { error: 'invalid signature' } };
  }

  let payload: {
    type?: string;
    operation?: string;
    providerConfigKey?: string;
    connectionId?: string;
    endUser?: {
      endUserId?: string;
      tags?: Record<string, string>;
    };
  };
  try {
    payload = JSON.parse(args.rawBody.toString('utf8'));
  } catch (err) {
    deps.log.warn('nango webhook body is not JSON', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 400, body: { error: 'invalid json' } };
  }

  // Nango sends both `type` (v2) and `operation` (legacy). We accept
  // whichever arrives; routing only cares about "created" vs. "deleted".
  const eventType = (payload.type ?? payload.operation ?? '').toLowerCase();
  const providerKey = payload.providerConfigKey;
  const connectionId = payload.connectionId;
  if (!providerKey || !connectionId) {
    return {
      status: 400,
      body: { error: 'missing providerConfigKey / connectionId in webhook' },
    };
  }

  if (providerKey !== GCAL_PROVIDER_KEY) {
    // Unknown provider — ack so Nango doesn't retry, but log loud so we
    // notice unregistered providers.
    deps.log.warn('nango webhook for provider we do not handle', { provider: providerKey });
    return { status: 204, body: {} };
  }

  if (eventType.includes('auth') && eventType.includes('success')) {
    // Nango v2 emits `auth` events distinct from `connection.created`.
    // Treat both as "create" since the UX is the same.
  }

  const isCreated =
    eventType === 'connection.created' || eventType === 'auth' || eventType.endsWith('.created');
  const isDeleted = eventType === 'connection.deleted' || eventType.endsWith('.deleted');

  if (isCreated) {
    return handleGcalConnectionCreated(deps, {
      nangoConnectionId: connectionId,
      tags: payload.endUser?.tags ?? {},
    });
  }
  if (isDeleted) {
    return handleGcalConnectionDeleted(deps, { nangoConnectionId: connectionId });
  }

  deps.log.info('nango webhook with non-actionable type; ignoring', { type: eventType });
  return { status: 204, body: {} };
}

async function handleGcalConnectionCreated(
  deps: WebhookIngestDeps,
  args: { nangoConnectionId: string; tags: Record<string, string> },
): Promise<WebhookResult> {
  const householdId = args.tags.household_id;
  const memberId = args.tags.member_id ?? null;
  if (!householdId) {
    deps.log.error('nango connection.created missing household_id tag', {
      nango_connection_id: args.nangoConnectionId,
    });
    return { status: 400, body: { error: 'household_id tag required on connect session' } };
  }

  // Idempotent insert: the unique (household_id, provider, nango_connection_id)
  // means a retried webhook lands on an existing row. We `select` back to
  // get the id either way.
  const { data: upserted, error: upsertErr } = await deps.supabase
    .schema('sync')
    .from('provider_connection')
    .upsert(
      {
        household_id: householdId,
        member_id: memberId,
        provider: GCAL_PROVIDER,
        nango_connection_id: args.nangoConnectionId,
        status: 'active',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'household_id,provider,nango_connection_id' },
    )
    .select('id, household_id, nango_connection_id')
    .maybeSingle();
  if (upsertErr) {
    throw new Error(`provider_connection upsert failed: ${upsertErr.message}`);
  }
  if (!upserted) {
    throw new Error('provider_connection upsert returned no row');
  }

  // Subscribe to push notifications. If this fails, we still mark the
  // connection created — the hourly poller picks up changes as a fall-
  // back and the operator can trigger a re-watch.
  try {
    if (deps.env.WEBHOOK_PUBLIC_URL) {
      const channelId = (deps.channelIdFactory ?? defaultChannelIdFactory)();
      const watchResult = await deps.calendar.watch({
        connectionId: args.nangoConnectionId,
        channelId,
        webhookUrl: `${deps.env.WEBHOOK_PUBLIC_URL.replace(/\/$/, '')}/webhooks/google-calendar`,
      });

      const value: GcalChannelValue & { channel_id: string } = {
        channel_id: watchResult.channelId,
        resource_id: watchResult.resourceId,
        expiration: watchResult.expiration,
      };
      const { error: cursorErr } = await deps.supabase
        .schema('sync')
        .from('cursor')
        .upsert(
          {
            connection_id: upserted.id,
            kind: GCAL_CHANNEL_KIND,
            value: JSON.stringify(value),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'connection_id,kind' },
        );
      if (cursorErr) {
        deps.log.error('failed to persist gcal channel cursor', { error: cursorErr.message });
      }
    } else {
      deps.log.warn('WEBHOOK_PUBLIC_URL unset; skipping events.watch subscription');
    }
  } catch (err) {
    deps.log.error('events.watch failed for new gcal connection', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Enqueue the initial full sync regardless of watch outcome.
  const now = (deps.now ?? (() => new Date()))();
  await deps.queues.send(queueNames.syncFull(GCAL_PROVIDER), {
    household_id: upserted.household_id,
    kind: 'sync.gcal.full',
    entity_id: upserted.id,
    version: 1,
    enqueued_at: now.toISOString(),
  });

  // Audit the creation.
  await writeAudit(deps.supabase, {
    household_id: upserted.household_id,
    action: 'sync.gcal.connection.created',
    resource_id: upserted.id,
    after: { nango_connection_id: args.nangoConnectionId, member_id: memberId },
  });

  deps.log.info('gcal connection created; full sync enqueued', {
    connection_id: upserted.id,
    household_id: upserted.household_id,
  });
  return { status: 204, body: {} };
}

async function handleGcalConnectionDeleted(
  deps: WebhookIngestDeps,
  args: { nangoConnectionId: string },
): Promise<WebhookResult> {
  const { data: connection, error: lookupErr } = await deps.supabase
    .schema('sync')
    .from('provider_connection')
    .select('id, household_id')
    .eq('provider', GCAL_PROVIDER)
    .eq('nango_connection_id', args.nangoConnectionId)
    .maybeSingle();
  if (lookupErr) throw new Error(`connection lookup failed: ${lookupErr.message}`);
  if (!connection) {
    // Nango may fire duplicate deletes; ack quietly.
    return { status: 204, body: {} };
  }

  // Fetch the channel cursor so we can unwatch before deleting it.
  const { data: channelCursor } = await deps.supabase
    .schema('sync')
    .from('cursor')
    .select('value')
    .eq('connection_id', connection.id)
    .eq('kind', GCAL_CHANNEL_KIND)
    .maybeSingle();
  const parsedChannel = parseChannelValue(channelCursor?.value ?? null);
  if (parsedChannel) {
    try {
      await deps.calendar.unwatch({
        connectionId: args.nangoConnectionId,
        channelId: parsedChannel.channel_id,
        resourceId: parsedChannel.resource_id,
      });
    } catch (err) {
      deps.log.warn('unwatch failed on connection.deleted; continuing', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await deps.supabase
    .schema('sync')
    .from('provider_connection')
    .update({ status: 'revoked', updated_at: new Date().toISOString() })
    .eq('id', connection.id);
  await deps.supabase.schema('sync').from('cursor').delete().eq('connection_id', connection.id);

  await writeAudit(deps.supabase, {
    household_id: connection.household_id,
    action: 'sync.gcal.connection.deleted',
    resource_id: connection.id,
    after: { nango_connection_id: args.nangoConnectionId },
  });

  deps.log.info('gcal connection revoked', { connection_id: connection.id });
  return { status: 204, body: {} };
}

// ---- helpers ------------------------------------------------------------

function headerAsString(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function parseChannelValue(raw: string | null): (GcalChannelValue & { channel_id: string }) | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed &&
      typeof parsed.channel_id === 'string' &&
      typeof parsed.resource_id === 'string' &&
      typeof parsed.expiration === 'string'
    ) {
      return parsed as GcalChannelValue & { channel_id: string };
    }
    return null;
  } catch {
    return null;
  }
}

function defaultChannelIdFactory(): string {
  // `crypto.randomUUID` is stable in Node 20+; matches package engines.
  return `hh-gcal-${globalThis.crypto.randomUUID()}`;
}

async function writeAudit(
  supabase: SupabaseClient<Database>,
  input: { household_id: string; action: string; resource_id: string; after: unknown },
): Promise<void> {
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
    console.warn(`[webhook-ingest] audit write failed: ${error.message}`);
  }
}
