/**
 * `sync-gmail` handler.
 *
 * Consumes pgmq messages from the per-provider queues:
 *   - `sync_full:gmail`  — initial sync: last 180d of messages matching
 *     the member's opt-in category filters.
 *   - `sync_delta:gmail` — incremental sync using the stored historyId.
 *
 * Contract per message envelope: `entity_id` carries the
 * `sync.provider_connection.id`. The worker resolves the household +
 * member from that row on every run so stale envelopes cannot be
 * replayed against a moved / revoked connection. The opt-in categories
 * ride inside `sync.provider_connection.metadata.email_categories` —
 * we source-of-truth them from the DB, not the message.
 *
 * Error policy:
 *   - `HistoryIdExpiredError` → the stored historyId is dead. Clear the
 *     cursor and requeue as `sync_full:gmail`. The current message is
 *     ack'd so pgmq doesn't double-process.
 *   - `RateLimitError`         → `nack` with a visibility bump matching
 *     Retry-After.
 *   - Any other error          → insert into `sync.dead_letter` with
 *     full envelope + reason and `ack`.
 *
 * Privacy:
 *   - Only `format=METADATA` fetched per message. Body preview is capped
 *     at 2KB in the adapter before persistence.
 *   - Attachments downloaded and uploaded to Supabase Storage under
 *     `<bucket>/<household_id>/email/<email_id>/<attachment_id>`.
 *   - Each ingested Gmail message gets the `HomeHub/Ingested` label so
 *     the member can audit in Gmail.
 *
 * Feature flag `HOMEHUB_EMAIL_INGESTION_ENABLED`:
 *   - When `false` (default), the worker still claims the message and
 *     logs `email ingestion disabled; skipping persist`. This lets the
 *     Nango connect + watch flow exercise against real environments
 *     during the migration-pending window without writing to tables
 *     that don't yet exist.
 *   - When `true`, the full persist + attachment upload + label flow
 *     runs.
 *
 * Idempotency: upserts on `(household_id, provider, source_id)` per the
 * partial unique index on `app.email` (see migration 0012 request).
 * Re-running a sync is safe.
 *
 * `app.email.segment` is set to `'system'` on sync; the M4-B extraction
 * worker reclassifies (`financial`, `food`, `fun`, `social`).
 */

import { type Database, type Json } from '@homehub/db';
import {
  type EmailCategory,
  type EmailMessage,
  type EmailProvider,
  HistoryIdExpiredError,
  HOMEHUB_INGESTED_LABEL_NAME,
  RateLimitError,
  buildGmailQuery,
  isEmailCategory,
} from '@homehub/providers-email';
import {
  type Logger,
  type MessageEnvelope,
  type QueueClient,
  queueNames,
} from '@homehub/worker-runtime';
import { type SupabaseClient } from '@supabase/supabase-js';

import {
  EMAIL_ATTACHMENTS_BUCKET,
  EMAIL_PROVIDER,
  type EmailAttachmentInsert,
  type EmailInsert,
} from './email-db.js';

/** Spec: 180 days initial sync. */
export const FULL_SYNC_PAST_DAYS = 180;

/** Cursor kind values we store in `sync.cursor`. */
export const CURSOR_KIND = {
  historyId: 'gmail.history_id',
  watch: 'gmail.watch',
} as const;

export interface GmailSyncHandlerDeps {
  supabase: SupabaseClient<Database>;
  queues: QueueClient;
  email: EmailProvider;
  log: Logger;
  /** Feature flag; false → worker no-ops persist and still acks. */
  ingestionEnabled: boolean;
  /** Injectable for tests. */
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
  metadata: Json | null;
}

interface CursorRow {
  kind: string;
  value: string | null;
}

/**
 * Top-level: claim → dispatch → handle errors → ack / nack / dead-letter.
 */
export async function pollOnce(deps: GmailSyncHandlerDeps): Promise<'claimed' | 'idle'> {
  const fullQueue = queueNames.syncFull(EMAIL_PROVIDER);
  const deltaQueue = queueNames.syncDelta(EMAIL_PROVIDER);

  // Try full-sync first so a freshly-connected account completes its
  // initial backfill before a delta races ahead of it.
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
      if (err instanceof HistoryIdExpiredError) {
        log.warn('history id invalidated; requeueing as full sync');
        try {
          await clearCursor(deps.supabase, claimed.payload.entity_id, CURSOR_KIND.historyId);
          await deps.queues.send(fullQueue, {
            ...claimed.payload,
            kind: 'sync.gmail.full',
          });
          await deps.queues.ack(queue, claimed.messageId);
        } catch (inner) {
          log.error('failed to requeue after HistoryIdExpiredError', {
            error: inner instanceof Error ? inner.message : String(inner),
          });
          await deps.queues.deadLetter(
            queue,
            claimed.messageId,
            'history-id-expired; requeue failed',
            claimed.payload,
          );
          await deps.queues.ack(queue, claimed.messageId);
        }
        return 'claimed';
      }

      if (err instanceof RateLimitError) {
        log.warn('gmail rate limit; nacking with visibility bump', {
          retry_after_seconds: err.retryAfterSeconds,
        });
        await deps.queues.nack(queue, claimed.messageId, {
          retryDelaySec: err.retryAfterSeconds,
        });
        return 'claimed';
      }

      const reason = err instanceof Error ? err.message : String(err);
      log.error('sync-gmail handler failed; dead-lettering', { error: reason });
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

async function runSync(deps: GmailSyncHandlerDeps, args: RunSyncArgs): Promise<void> {
  const { supabase, email, log } = deps;
  const now = (deps.now ?? (() => new Date()))();

  const connection = await loadConnection(supabase, args.connectionId);
  if (!connection) {
    throw new Error(`connection not found: ${args.connectionId}`);
  }
  if (connection.provider !== EMAIL_PROVIDER) {
    throw new Error(
      `connection ${connection.id} is provider=${connection.provider}, expected ${EMAIL_PROVIDER}`,
    );
  }
  if (connection.status === 'revoked') {
    throw new Error(`connection ${connection.id} is revoked`);
  }

  const categories = readCategoriesFromMetadata(connection.metadata);
  if (categories.length === 0) {
    log.info('no email categories opted in; skipping sync');
    return;
  }

  const query = buildGmailQuery({
    categories,
    ...(args.mode === 'full' ? { withinDays: FULL_SYNC_PAST_DAYS } : {}),
  });

  log.info('sync starting', {
    nango_connection_id: connection.nango_connection_id,
    categories,
    ingestion_enabled: deps.ingestionEnabled,
  });

  const existingHistoryId =
    args.mode === 'delta'
      ? await getCursorValue(supabase, connection.id, CURSOR_KIND.historyId)
      : undefined;

  // Ensure the HomeHub/Ingested label exists once per sync so addLabel
  // calls are cheap. Skipped when ingestion is disabled (no label
  // mutation until the persistence pipeline is green).
  let ingestedLabelId: string | undefined;
  if (deps.ingestionEnabled) {
    try {
      const { labelId } = await email.ensureLabel({
        connectionId: connection.nango_connection_id,
        name: HOMEHUB_INGESTED_LABEL_NAME,
      });
      ingestedLabelId = labelId;
    } catch (err) {
      // Label is nice-to-have, not load-bearing. Log and continue.
      log.warn('ensureLabel failed; ingested messages will not be tagged in Gmail', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let processedCount = 0;
  let nextHistoryId: string | undefined;

  for await (const page of email.listRecentMessages({
    connectionId: connection.nango_connection_id,
    query,
    ...(existingHistoryId ? { afterHistoryId: existingHistoryId } : {}),
  })) {
    if (page.messages.length === 0 && !page.nextHistoryId) {
      continue;
    }

    if (deps.ingestionEnabled) {
      const upserted = await upsertEmailsPage(supabase, connection, page.messages, categories, now);
      processedCount += upserted.length;

      if (upserted.length > 0) {
        await persistAttachments(deps, connection, upserted);
        await enqueueEnrichment(deps.queues, connection.household_id, upserted, now);
        await labelAll(deps, connection.nango_connection_id, upserted, ingestedLabelId);
      }
    } else {
      log.info('email ingestion disabled; skipping persist', {
        batch_size: page.messages.length,
      });
      processedCount += page.messages.length;
    }

    if (page.nextHistoryId) nextHistoryId = page.nextHistoryId;
  }

  if (nextHistoryId) {
    await upsertCursor(supabase, connection.id, CURSOR_KIND.historyId, nextHistoryId);
  }

  await supabase
    .schema('sync')
    .from('provider_connection')
    .update({ last_synced_at: now.toISOString(), status: 'active' })
    .eq('id', connection.id);

  await writeAudit(supabase, {
    household_id: connection.household_id,
    action: `sync.gmail.${args.mode}.completed`,
    resource_id: connection.id,
    after: {
      processed_messages: processedCount,
      next_history_id_written: Boolean(nextHistoryId),
      ingestion_enabled: deps.ingestionEnabled,
    },
  });

  log.info('sync completed', { processed_count: processedCount });
}

// ---- Categories ---------------------------------------------------------

interface ConnectionMetadataShape {
  email_categories?: unknown;
}

/**
 * Extract opted-in categories from the connection row's metadata. We
 * validate each string against the allowlist so a stale migration or a
 * mis-serialized row cannot sneak an unexpected filter through.
 */
export function readCategoriesFromMetadata(metadata: Json | null): EmailCategory[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  const raw = (metadata as ConnectionMetadataShape).email_categories;
  if (!Array.isArray(raw)) return [];
  const out: EmailCategory[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string' && isEmailCategory(entry) && !out.includes(entry)) {
      out.push(entry);
    }
  }
  return out;
}

// ---- Persistence --------------------------------------------------------

interface UpsertedEmailSummary {
  id: string;
  source_id: string;
  /** Echoed through from the provider so we can queue attachment uploads. */
  message: EmailMessage;
}

async function upsertEmailsPage(
  supabase: SupabaseClient<Database>,
  connection: ConnectionRow,
  messages: EmailMessage[],
  optInCategories: readonly EmailCategory[],
  now: Date,
): Promise<UpsertedEmailSummary[]> {
  if (messages.length === 0) return [];

  const rows: EmailInsert[] = messages.map((m) => ({
    household_id: connection.household_id,
    member_id: connection.member_id,
    connection_id: connection.id,
    provider: EMAIL_PROVIDER,
    source_id: m.sourceId,
    source_version: m.historyId,
    thread_id: m.threadId,
    subject: m.subject,
    from_email: m.fromEmail,
    from_name: m.fromName ?? null,
    to_emails: m.toEmails,
    received_at: m.receivedAt,
    categories: classifyCategories(m, optInCategories),
    body_preview: m.bodyPreview,
    has_attachments: m.attachments.length > 0,
    labels: m.labels,
    metadata: {
      headers: m.headers,
      ...(m.attachments.length > 0 ? { attachments: m.attachments } : {}),
    } as unknown as Json,
    segment: 'system',
    updated_at: now.toISOString(),
  }));

  // We cast through `unknown` here because `Database` does not yet know
  // about `app.email`. Post-migration, regenerate types and drop the cast.
  const { data, error } = await (
    supabase.schema('app').from('email' as never) as unknown as {
      upsert: (
        rows: EmailInsert[],
        options: { onConflict: string },
      ) => {
        select: (cols: string) => Promise<{
          data: Array<{ id: string; source_id: string }> | null;
          error: { message: string } | null;
        }>;
      };
    }
  )
    .upsert(rows, { onConflict: 'household_id,provider,source_id' })
    .select('id, source_id');
  if (error) throw new Error(`app.email upsert failed: ${error.message}`);
  const dataRows = data ?? [];
  const byId = new Map(messages.map((m) => [m.sourceId, m]));
  return dataRows.map((r) => ({
    id: r.id,
    source_id: r.source_id,
    message: byId.get(r.source_id)!,
  }));
}

/**
 * Heuristic category tagging at sync time: match the message against the
 * filter keywords we already know about. The model-backed refinement
 * happens in M4-B. Always intersected with the member's opt-in set so
 * we can't surface a category they haven't consented to.
 */
export function classifyCategories(
  message: EmailMessage,
  optIn: readonly EmailCategory[],
): EmailCategory[] {
  const haystack = `${message.subject} ${message.fromEmail}`.toLowerCase();
  const hits = new Set<EmailCategory>();
  for (const category of optIn) {
    if (matchesCategory(category, haystack, message)) hits.add(category);
  }
  return [...hits];
}

function matchesCategory(
  category: EmailCategory,
  haystack: string,
  message: EmailMessage,
): boolean {
  switch (category) {
    case 'receipt':
      return /receipt|order confirmation|your order|purchase|paid|invoice/.test(haystack);
    case 'reservation':
      return /reservation|booking|itinerary|confirmation|opentable|resy|airbnb|booking\.com|hotel|flight/.test(
        haystack,
      );
    case 'bill':
      return /bill|statement|invoice|amount due|autopay|payment due/.test(haystack);
    case 'invite':
      return message.attachments.some((a) => a.filename.toLowerCase().endsWith('.ics'));
    case 'shipping':
      return /shipped|tracking|out for delivery|delivered|shipment/.test(haystack);
    default:
      return false;
  }
}

// ---- Attachments --------------------------------------------------------

interface StorageClientShape {
  from(bucket: string): {
    upload: (
      path: string,
      data: Uint8Array | Buffer,
      options?: { contentType?: string; upsert?: boolean },
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
}

async function persistAttachments(
  deps: GmailSyncHandlerDeps,
  connection: ConnectionRow,
  upserted: UpsertedEmailSummary[],
): Promise<void> {
  const { supabase, email, log } = deps;
  const storage = (supabase as unknown as { storage: StorageClientShape }).storage;

  for (const row of upserted) {
    const atts = row.message.attachments;
    if (atts.length === 0) continue;

    for (const att of atts) {
      try {
        const data = await email.fetchAttachment({
          connectionId: connection.nango_connection_id,
          messageId: row.message.sourceId,
          attachmentId: att.partId,
        });
        const buffer = Buffer.from(data.contentBase64, 'base64');
        const attachmentId = globalThis.crypto.randomUUID();
        const storagePath = `${connection.household_id}/email/${row.id}/${attachmentId}`;
        const up = await storage.from(EMAIL_ATTACHMENTS_BUCKET).upload(storagePath, buffer, {
          contentType: att.contentType,
          upsert: false,
        });
        if (up.error) throw new Error(up.error.message);

        const insertRow: EmailAttachmentInsert = {
          household_id: connection.household_id,
          email_id: row.id,
          filename: att.filename,
          content_type: att.contentType,
          size_bytes: buffer.byteLength,
          storage_path: storagePath,
        };
        const { error } = await (
          supabase.schema('app').from('email_attachment' as never) as unknown as {
            insert: (r: EmailAttachmentInsert) => Promise<{ error: { message: string } | null }>;
          }
        ).insert(insertRow);
        if (error) throw new Error(`app.email_attachment insert failed: ${error.message}`);
      } catch (err) {
        // Attachment failures never fail the whole message — the email
        // row is already persisted and retry on next sync is cheap.
        log.warn('attachment persist failed; continuing', {
          email_id: row.id,
          filename: att.filename,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

// ---- Labeling -----------------------------------------------------------

async function labelAll(
  deps: GmailSyncHandlerDeps,
  nangoConnectionId: string,
  upserted: UpsertedEmailSummary[],
  labelId: string | undefined,
): Promise<void> {
  if (!labelId) return;
  for (const row of upserted) {
    try {
      await deps.email.addLabel({
        connectionId: nangoConnectionId,
        messageId: row.message.sourceId,
        labelId,
      });
    } catch (err) {
      deps.log.warn('addLabel failed; will retry on next sync', {
        message_id: row.message.sourceId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ---- Enqueue enrichment -------------------------------------------------

async function enqueueEnrichment(
  queues: QueueClient,
  householdId: string,
  upserted: UpsertedEmailSummary[],
  now: Date,
): Promise<void> {
  const envelopes: MessageEnvelope[] = upserted.map((row) => ({
    household_id: householdId,
    kind: 'enrich.email',
    entity_id: row.id,
    version: 1,
    enqueued_at: now.toISOString(),
  }));
  await queues.sendBatch(queueNames.enrichEmail, envelopes);
}

// ---- Supabase helpers ---------------------------------------------------

async function loadConnection(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<ConnectionRow | null> {
  // `metadata` is not on the generated provider_connection shape today;
  // once migration 0012 extends the row (or if the canonical migration
  // already supports metadata — see M4-A request), regen types. We cast
  // so the select still compiles.
  const { data, error } = await (supabase
    .schema('sync')
    .from('provider_connection')
    .select('id, household_id, member_id, provider, nango_connection_id, status, metadata')
    .eq('id', id)
    .maybeSingle() as unknown as Promise<{
    data: (Omit<ConnectionRow, 'metadata'> & { metadata?: Json | null }) | null;
    error: { message: string } | null;
  }>);
  if (error) throw new Error(`provider_connection lookup failed: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    household_id: data.household_id,
    member_id: data.member_id,
    provider: data.provider,
    nango_connection_id: data.nango_connection_id,
    status: data.status,
    metadata: data.metadata ?? null,
  };
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

async function clearCursor(
  supabase: SupabaseClient<Database>,
  connectionId: string,
  kind: string,
): Promise<void> {
  const { error } = await supabase
    .schema('sync')
    .from('cursor')
    .delete()
    .eq('connection_id', connectionId)
    .eq('kind', kind);
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
    // Intentionally not thrown — audit failures must not fail the sync.

    console.warn(`[sync-gmail] audit write failed: ${error.message}`);
  }
}
