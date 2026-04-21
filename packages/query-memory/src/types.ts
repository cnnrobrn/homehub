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

/** Default recency half-life when the caller doesn't override. */
export const DEFAULT_RECENCY_HALF_LIFE_DAYS = 30;

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
