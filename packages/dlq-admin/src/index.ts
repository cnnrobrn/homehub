/**
 * `@homehub/dlq-admin` — primitives for triaging the dead-letter queue.
 *
 * The worker runtime writes failed message envelopes into
 * `sync.dead_letter` (see migration 0009). Operators and the internal
 * `/ops/dlq` page call the helpers below to list, replay, and purge
 * those rows.
 *
 * The primitives are framework-agnostic: a `ServiceSupabaseClient` and
 * (for replay) a `QueueClient` are passed in. The web app binds those to
 * its own instances; the CLI constructs them from `workerRuntimeEnv`.
 */

export {
  listDeadLetters,
  purgeDeadLetter,
  replayDeadLetter,
  type DlqEntry,
  type DlqQueueClient,
  type ListDeadLettersArgs,
  type ReplayResult,
} from './primitives.js';
