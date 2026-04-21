/**
 * `@homehub/query-memory` — barrel.
 *
 * Exports the `query_memory` client factory + the public types so
 * the foreground agent, MCP memory tool (M3-C), and graph browser
 * (M3-D) can consume a stable surface. Also exports the ranking
 * primitives for advanced callers that want to re-score on their own.
 */

export {
  createQueryMemory,
  type CreateQueryMemoryOptions,
  type QueryMemoryClient,
} from './query.js';

export {
  DEFAULT_RANKING_WEIGHTS,
  DEFAULT_RECENCY_HALF_LIFE_DAYS,
  type EdgeRow,
  type EpisodeRow,
  type FactRow,
  type NodeRow,
  type PatternRow,
  type QueryLayer,
  type QueryMemoryArgs,
  type QueryMemoryResult,
  type RankingWeights,
} from './types.js';

export {
  cosineSimilarity,
  normalizedSimilarity,
  recencyWeight,
  connectivityWeight,
  typePriorWeight,
  conflictPenalty,
  scoreNode,
  scoreFact,
} from './ranking.js';
