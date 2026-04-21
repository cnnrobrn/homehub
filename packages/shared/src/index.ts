/**
 * `@homehub/shared` — primitives shared across HomeHub packages.
 *
 * Keep this package small. It is imported by the DB package, the worker
 * runtime, and (later) the web app. Anything with a non-trivial
 * dependency graph belongs somewhere else.
 */

export {
  baseServerEnvSchema,
  loadEnv,
  logLevelSchema,
  type BaseServerEnv,
  type LogLevel,
} from './env.js';

export {
  uuid,
  type ActionId,
  type ConnectionId,
  type EpisodeId,
  type EventId,
  type FactId,
  type HouseholdId,
  type MemberId,
  type NodeId,
  type SuggestionId,
  type TransactionId,
} from './ids.js';

export { addDays, addHours, addMinutes, fromIso, now, toIso } from './time.js';

export { formatMoney, fromCents, toCents, type Cents } from './money.js';

export {
  CANDIDATE_STATUSES,
  CONFLICT_STATUSES,
  EDGE_TYPES,
  EPISODE_SOURCE_TYPES,
  FACT_SOURCES,
  NODE_TYPES,
  type CandidateStatus,
  type ConflictStatus,
  type EdgeType,
  type EpisodeSourceType,
  type FactSource,
  type NodeType,
} from './memory/node-types.js';

export { SEGMENTS, type CalendarEventRow, type Segment } from './events/types.js';
