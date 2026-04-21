/**
 * Dead-letter queue primitives.
 *
 * `sync.dead_letter` is the landing zone for messages the worker runtime
 * gave up on. Its columns:
 *   - id             — uuid pk
 *   - connection_id  — fk to sync.provider_connection (nullable)
 *   - queue          — source queue name
 *   - message_id     — original pgmq message id (nullable)
 *   - payload        — full MessageEnvelope as jsonb
 *   - error          — human-readable reason
 *   - received_at    — insert timestamp
 *
 * Scoping: household filter is resolved through
 * `sync.provider_connection.household_id`. Entries without a connection
 * id fall into a "global" bucket and are only visible when the caller
 * omits `householdId`. The web `/ops/dlq` page is per-household so it
 * always passes `householdId`.
 *
 * Replay: writes the stored payload back onto `queue` via the pgmq
 * wrapper. The original row is left in place so operators can replay
 * again (e.g. after fixing a data issue). Callers that want to delete
 * after a successful replay call `purgeDeadLetter` separately — keep the
 * ops actions explicit.
 *
 * Purge: soft-deletes by `delete from sync.dead_letter where id = ?`.
 * `sync.dead_letter` is operational / small, so hard-delete is fine; we
 * pick the explicit verb `purge` in the surface to signal destructive
 * intent to the caller.
 */

import { type Database } from '@homehub/db';
import { messageEnvelopeSchema, type MessageEnvelope } from '@homehub/worker-runtime';
import { type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

export interface DlqEntry {
  id: string;
  connectionId: string | null;
  queue: string;
  messageId: number | null;
  payload: unknown;
  error: string;
  receivedAt: string;
  /**
   * Household id for the originating provider connection, when resolvable.
   * `null` when the DLQ row has no connection (payloads produced by
   * workers that don't carry a connection id).
   */
  householdId: string | null;
}

export interface ListDeadLettersArgs {
  queue?: string;
  householdId?: string;
  limit?: number;
}

/**
 * Minimal shape of the worker-runtime `QueueClient` we need for replay.
 * Re-declared here (rather than importing the concrete type) so tests
 * can pass a stub without standing up the full runtime client.
 */
export interface DlqQueueClient {
  send(queue: string, payload: MessageEnvelope): Promise<number>;
}

export interface ReplayResult {
  enqueued: boolean;
  reason?: string;
}

type ServiceClient = SupabaseClient<Database>;

const listArgsSchema = z.object({
  queue: z.string().min(1).optional(),
  householdId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

/**
 * Lists DLQ entries. Rows are returned in `received_at DESC` order so
 * the most recent failures surface first. When `householdId` is set, only
 * rows whose backing `sync.provider_connection.household_id` matches are
 * returned; rows without a connection are excluded in that mode.
 */
export async function listDeadLetters(
  supabase: ServiceClient,
  rawArgs: ListDeadLettersArgs = {},
): Promise<DlqEntry[]> {
  const args = listArgsSchema.parse(rawArgs);

  let query = supabase
    .schema('sync')
    .from('dead_letter')
    .select(
      'id, connection_id, queue, message_id, payload, error, received_at, connection:connection_id(household_id)',
    )
    .order('received_at', { ascending: false })
    .limit(args.limit);

  if (args.queue) {
    query = query.eq('queue', args.queue);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`listDeadLetters: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{
    id: string;
    connection_id: string | null;
    queue: string;
    message_id: number | null;
    payload: unknown;
    error: string;
    received_at: string;
    connection: { household_id: string | null } | Array<{ household_id: string | null }> | null;
  }>;

  const normalized: DlqEntry[] = rows.map((r) => {
    const connRaw = r.connection;
    const conn = Array.isArray(connRaw) ? (connRaw[0] ?? null) : connRaw;
    return {
      id: r.id,
      connectionId: r.connection_id,
      queue: r.queue,
      messageId: r.message_id,
      payload: r.payload,
      error: r.error,
      receivedAt: r.received_at,
      householdId: conn?.household_id ?? null,
    };
  });

  if (args.householdId) {
    // PostgREST can't filter a joined column inline without an `!inner`
    // hint on the relationship, which would also drop null-connection
    // rows. The table is small and per-household scopes are operator-only,
    // so filter in Node for clarity.
    return normalized.filter((e) => e.householdId === args.householdId);
  }
  return normalized;
}

/**
 * Replays a DLQ entry by re-sending its stored envelope to its queue.
 * Returns `{ enqueued: false, reason }` when the row can't be replayed
 * (missing, malformed, etc.) so the caller can render a friendly message.
 * The original DLQ row is left intact; call `purgeDeadLetter` after a
 * successful replay if you don't want to keep the record.
 */
export async function replayDeadLetter(
  supabase: ServiceClient,
  queues: DlqQueueClient,
  id: string,
): Promise<ReplayResult> {
  const { data, error } = await supabase
    .schema('sync')
    .from('dead_letter')
    .select('id, queue, payload')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    return { enqueued: false, reason: `lookup failed: ${error.message}` };
  }
  if (!data) {
    return { enqueued: false, reason: 'not found' };
  }
  const envelopeResult = messageEnvelopeSchema.safeParse(data.payload);
  if (!envelopeResult.success) {
    return {
      enqueued: false,
      reason: `payload is not a valid MessageEnvelope: ${envelopeResult.error.issues
        .map((i) => i.message)
        .join('; ')}`,
    };
  }
  try {
    await queues.send(data.queue, envelopeResult.data);
  } catch (err) {
    return {
      enqueued: false,
      reason: `enqueue failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { enqueued: true };
}

/**
 * Deletes a DLQ row by id. Idempotent — missing rows return successfully.
 */
export async function purgeDeadLetter(supabase: ServiceClient, id: string): Promise<void> {
  const { error } = await supabase.schema('sync').from('dead_letter').delete().eq('id', id);
  if (error) {
    throw new Error(`purgeDeadLetter: ${error.message}`);
  }
}
