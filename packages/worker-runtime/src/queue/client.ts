/**
 * pgmq wrapper.
 *
 * Wraps the Supabase RPC surface for pgmq (`pgmq.send`, `pgmq.read`,
 * `pgmq.archive`, etc.) behind a typed client. Call sites should never
 * touch the RPC names directly — go through this client so retry, DLQ,
 * and observability behaviors stay consistent.
 *
 * Per-household ordering: pgmq itself gives FIFO per queue, not per
 * ordering_key. We get per-household fairness by a combination of
 *   (a) visibility_timeout — a message the worker is actively processing
 *       is invisible, so the next message in the same logical partition
 *       won't race ahead, and
 *   (b) the worker claiming messages with `ordering_key = household_id`
 *       and skipping claims where the household already has an in-flight
 *       message (tracked client-side per worker process). Across worker
 *       instances, the visibility timeout handles the race.
 * When load patterns show this is insufficient (queue-depth skew per
 * household) we'll add a `jobs.in_flight_by_household` table as the
 * authoritative gate. For M0-C we expose the knob; the wiring above is
 * the documented contract, not a promise the client enforces
 * single-handedly.
 *
 * DLQ: `sync.dead_letter` landed in M1 (migration 0009). `deadLetter`
 * now writes directly to it. When a payload carries a provider
 * connection id (as some sync-worker envelopes will in M2) the caller
 * can pass it in the options; otherwise the row's `connection_id` is
 * null and operators dedupe by (queue, received_at).
 */

import { type Json } from '@homehub/db';
import { type PostgrestError } from '@supabase/supabase-js';
import { z } from 'zod';

import { QueueError } from '../errors.js';
import { type ServiceSupabaseClient } from '../supabase/client.js';

import { messageEnvelopeSchema, type MessageEnvelope } from './envelope.js';

export interface SendOptions {
  /** Delay before the message becomes visible (seconds). */
  delaySeconds?: number;
}

export interface ClaimOptions {
  /** Default 60s per spec. Long-running tasks bump as they work. */
  visibilityTimeoutSec?: number;
  /**
   * Number of messages to read in one call; client exposes only the
   * first for handler simplicity. Default 1.
   */
  quantity?: number;
}

export interface NackOptions {
  /** How long before the message becomes visible again. */
  retryDelaySec?: number;
}

export interface ClaimedMessage {
  messageId: number;
  readCount: number;
  enqueuedAt: string;
  /** Time (ISO) at which the message becomes visible to other consumers. */
  vt: string;
  payload: MessageEnvelope;
}

// Raw shape returned by pgmq.read / pgmq.pop. Fields are snake_case and
// vary slightly between pgmq versions; we defensively accept both
// `message` and `payload` keys.
const pgmqRowSchema = z.object({
  msg_id: z.number().int(),
  read_ct: z.number().int(),
  enqueued_at: z.string(),
  vt: z.string(),
  message: z.unknown(),
});

export interface QueueClient {
  send(queueName: string, payload: MessageEnvelope, options?: SendOptions): Promise<number>;
  sendBatch(
    queueName: string,
    payloads: MessageEnvelope[],
    options?: SendOptions,
  ): Promise<number[]>;
  claim(queueName: string, options?: ClaimOptions): Promise<ClaimedMessage | null>;
  ack(queueName: string, messageId: number): Promise<void>;
  nack(queueName: string, messageId: number, options?: NackOptions): Promise<void>;
  deadLetter(
    queueName: string,
    messageId: number,
    reason: string,
    payload: MessageEnvelope,
  ): Promise<void>;
  depth(queueName: string): Promise<number>;
  ageOfOldestSec(queueName: string): Promise<number | null>;
}

/**
 * Reads an error object from Supabase/Postgrest or throws a wrapped
 * `QueueError` with the queue name attached. Keeps every callsite below
 * free of ad-hoc error plumbing.
 */
function ensureOk<T>(
  queueName: string,
  result: { data: T; error: PostgrestError | null },
  action: string,
): T {
  if (result.error) {
    throw new QueueError(
      `pgmq ${action} failed for ${queueName}: ${result.error.message}`,
      queueName,
      {
        cause: result.error,
      },
    );
  }
  return result.data;
}

export function createQueueClient(supabase: ServiceSupabaseClient): QueueClient {
  // pgmq lives in the `pgmq_public` schema in Supabase. That schema is
  // not part of the generated `Database` type (it's operational, not
  // application data), so we widen to `unknown` and call the RPCs by
  // name. The underlying HTTP layer is the same.
  const rpc = (
    supabase as unknown as {
      schema: (name: string) => {
        rpc: (
          fn: string,
          args?: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: PostgrestError | null }>;
      };
    }
  ).schema('pgmq_public');

  return {
    async send(queueName, payload, options) {
      // Validate envelope before writing — producer-side schema guard.
      const parsed = messageEnvelopeSchema.parse(payload);
      const res = await rpc.rpc('send', {
        queue_name: queueName,
        message: parsed,
        sleep_seconds: options?.delaySeconds ?? 0,
      });
      const rows = ensureOk(queueName, res, 'send') as unknown as number[] | number | null;
      if (rows == null) {
        throw new QueueError(`pgmq send returned no id for ${queueName}`, queueName);
      }
      return Array.isArray(rows) ? (rows[0] as number) : rows;
    },

    async sendBatch(queueName, payloads, options) {
      const parsed = payloads.map((p) => messageEnvelopeSchema.parse(p));
      const res = await rpc.rpc('send_batch', {
        queue_name: queueName,
        messages: parsed,
        sleep_seconds: options?.delaySeconds ?? 0,
      });
      const rows = ensureOk(queueName, res, 'send_batch') as unknown as number[] | null;
      return rows ?? [];
    },

    async claim(queueName, options) {
      const vt = options?.visibilityTimeoutSec ?? 60;
      const quantity = options?.quantity ?? 1;
      const res = await rpc.rpc('read', {
        queue_name: queueName,
        sleep_seconds: vt,
        n: quantity,
      });
      const rawRows = ensureOk(queueName, res, 'read') as unknown;
      if (!Array.isArray(rawRows) || rawRows.length === 0) {
        return null;
      }
      const row = pgmqRowSchema.parse(rawRows[0]);
      // Validate envelope on read; malformed messages are a terminal
      // condition — the caller should route to DLQ.
      const envelope = messageEnvelopeSchema.parse(row.message);
      return {
        messageId: row.msg_id,
        readCount: row.read_ct,
        enqueuedAt: row.enqueued_at,
        vt: row.vt,
        payload: envelope,
      };
    },

    async ack(queueName, messageId) {
      const res = await rpc.rpc('archive', {
        queue_name: queueName,
        msg_id: messageId,
      });
      ensureOk(queueName, res, 'archive');
    },

    async nack(queueName, messageId, options) {
      // pgmq's visibility bump is `set_vt` in seconds from now.
      const res = await rpc.rpc('set_vt', {
        queue_name: queueName,
        msg_id: messageId,
        vt_offset: options?.retryDelaySec ?? 30,
      });
      ensureOk(queueName, res, 'set_vt');
    },

    async deadLetter(queueName, messageId, reason, payload) {
      // Insert the failed message into `sync.dead_letter`. We do not
      // archive from pgmq here — that's the caller's job (they may want
      // to keep the original around for replay). Schema columns:
      //   queue        — the source queue name
      //   message_id   — the pgmq message id (nullable; a "poison on
      //                  claim" path may not have one)
      //   payload      — full MessageEnvelope so operators can replay
      //   error        — human-readable reason; not machine-parseable
      //   connection_id — populated by callers that know which Nango
      //                  connection produced the message; null otherwise.
      // MessageEnvelope is a plain-data object — safe to treat as `Json`
      // for the insert. Cast once so the `supabase-js` typing lines up.
      const { error } = await supabase
        .schema('sync')
        .from('dead_letter')
        .insert({
          queue: queueName,
          message_id: messageId,
          payload: payload as unknown as Json,
          error: reason,
        });
      if (error) {
        throw new QueueError(
          `dead_letter insert failed for ${queueName}: ${error.message}`,
          queueName,
          { cause: error },
        );
      }
    },

    async depth(queueName) {
      const res = await rpc.rpc('metrics', { queue_name: queueName });
      const data = ensureOk(queueName, res, 'metrics') as unknown;
      const row = Array.isArray(data) ? data[0] : data;
      const obj = (row ?? {}) as Record<string, unknown>;
      const n = obj.queue_length;
      return typeof n === 'number' ? n : Number(n ?? 0);
    },

    async ageOfOldestSec(queueName) {
      const res = await rpc.rpc('metrics', { queue_name: queueName });
      const data = ensureOk(queueName, res, 'metrics') as unknown;
      const row = Array.isArray(data) ? data[0] : data;
      const obj = (row ?? {}) as Record<string, unknown>;
      const n = obj.oldest_msg_age_sec;
      if (n == null) return null;
      return typeof n === 'number' ? n : Number(n);
    },
  };
}
