/**
 * Types for the `query_memory` runtime surface.
 *
 * These are the public shapes imported by the foreground agent, the
 * MCP memory tool (M3-C), and the graph browser (M3-D). Keep them
 * flat / serializable — they cross process boundaries.
 */

import { type Database, type Json } from '@homehub/db';
import {
  type EpisodeSourceType,
  type FactSource,
  type HouseholdId,
  type NodeType,
} from '@homehub/shared';

/** Memory layers queryable by the retrieval tool. */
export type QueryLayer = 'episodic' | 'semantic' | 'procedural';

export interface QueryMemoryArgs {
  householdId: HouseholdId;
  query: string;
  layers?: QueryLayer[];
  types?: NodeType[];
  include_documents?: boolean;
  include_conflicts?: boolean;
  max_depth?: number;
  limit?: number;
  as_of?: string; // ISO datetime
  recency_half_life_days?: number;
  /**
   * Weights override (advanced). If absent, the defaults from
   * `specs/04-memory-network/retrieval.md` apply.
   */
  weights?: Partial<RankingWeights>;
}

export interface RankingWeights {
  /** Semantic similarity weight. Spec default: 0.5 */
  semantic: number;
  /** Recency weight. Spec default: 0.15 */
  recency: number;
  /** Connectivity (edge count) weight. Spec default: 0.1 */
  connectivity: number;
  /** Node-type prior weight. Spec default: 0.05 */
  typePrior: number;
  /** Fact confidence weight. Spec default: 0.15 */
  confidence: number;
  /** Conflict penalty weight. Spec default: 0.05 */
  conflict: number;
}

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  semantic: 0.5,
  recency: 0.15,
  connectivity: 0.1,
  typePrior: 0.05,
  confidence: 0.15,
  conflict: 0.05,
};

/**
 * Default recency half-life when the caller doesn't override. Retained
 * for backward compat with callers that passed a flat half-life; M3.7-A
 * replaces the single number with layer-specific and type-specific
 * curves (see `ranking.ts`).
 */
export const DEFAULT_RECENCY_HALF_LIFE_DAYS = 30;

/**
 * Layer-specific recency half-lives (days). From
 * `specs/04-memory-network/consolidation.md` § Decay: "half-life
 * defaults vary by entity type". M3.7-A formalizes the per-layer
 * curves — episodic fades fastest (a dinner from 14 days ago is still
 * vivid, from 42 days ago largely not), semantic is slower (stable
 * facts), procedural is slowest (patterns are long-running).
 */
export const HALF_LIFE_EPISODIC_DAYS = 14;
export const HALF_LIFE_SEMANTIC_DAYS = 120;
export const HALF_LIFE_PROCEDURAL_DAYS = 365;

/**
 * Per-entity-type half-life overrides on the semantic layer. Per
 * consolidation.md: person nodes decay slower than merchants (people
 * are high-salience long-term); places slower still (where you live
 * doesn't move); dishes and the catch-all land on the semantic
 * default. `default` is the fallback when the node type is not listed
 * below.
 */
export const SEMANTIC_NODE_HALF_LIFE_DAYS: Readonly<Record<string, number>> = {
  person: 180,
  merchant: 90,
  place: 365,
  dish: 120,
  default: HALF_LIFE_SEMANTIC_DAYS,
};

/**
 * Pattern decay multiplier — per consolidation.md: "If a pattern isn't
 * reinforced within a threshold (typically 3× its natural period), its
 * confidence decays toward zero." We zero out the ranking weight for
 * these patterns and exclude them from default retrieval; they remain
 * queryable via `as_of`.
 */
export const PATTERN_DECAY_MULTIPLIER = 3;

/**
 * Old-candidate filter threshold. Per consolidation.md: "Candidate
 * facts expire after 90 days unless reinforced." We drop them from
 * ranked retrieval at the filter stage (still on disk).
 */
export const CANDIDATE_MAX_AGE_DAYS = 90;

export type NodeRow = Database['mem']['Tables']['node']['Row'];
export type EdgeRow = Database['mem']['Tables']['edge']['Row'];
export type FactRow = Database['mem']['Tables']['fact']['Row'];
export type EpisodeRow = Database['mem']['Tables']['episode']['Row'];
export type PatternRow = Database['mem']['Tables']['pattern']['Row'];

export interface QueryMemoryResult {
  nodes: NodeRow[];
  edges: EdgeRow[];
  facts: FactRow[];
  episodes: EpisodeRow[];
  patterns: PatternRow[];
  /** Facts with `conflict_status != 'none'` or recent supersession. */
  conflicts: FactRow[];
}

export type { Database, Json, EpisodeSourceType, FactSource, NodeType };
