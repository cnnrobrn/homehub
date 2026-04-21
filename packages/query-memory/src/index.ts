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
  CANDIDATE_MAX_AGE_DAYS,
  DEFAULT_RANKING_WEIGHTS,
  DEFAULT_RECENCY_HALF_LIFE_DAYS,
  HALF_LIFE_EPISODIC_DAYS,
  HALF_LIFE_PROCEDURAL_DAYS,
  HALF_LIFE_SEMANTIC_DAYS,
  PATTERN_DECAY_MULTIPLIER,
  SEMANTIC_NODE_HALF_LIFE_DAYS,
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
  defaultHalfLifeFor,
  isPatternDecayed,
  scoreNode,
  scoreFact,
  scorePattern,
} from './ranking.js';
