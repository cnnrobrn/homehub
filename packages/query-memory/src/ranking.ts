/**
 * Ranking helpers for the query_memory surface.
 *
 * Formula (from `specs/04-memory-network/retrieval.md`):
 *
 *     score = α * semantic_similarity
 *           + β * recency_weight(last_reinforced_at)
 *           + γ * connectivity_weight(edge_count)
 *           + δ * type_prior(types filter)
 *           + ε * confidence          (facts only)
 *           − ζ * conflict_penalty    (facts with contradictions)
 *
 * Weights are tunable per-agent; the spec defaults live in `types.ts`.
 *
 * Semantic similarity is cosine similarity in [-1, 1]; we map to [0, 1]
 * for the mixing equation via `(1 + cos) / 2` so a perfectly opposite
 * vector doesn't produce a negative score that then gets amplified.
 */

import {
  DEFAULT_RECENCY_HALF_LIFE_DAYS,
  type FactRow,
  type NodeRow,
  type NodeType,
  type RankingWeights,
} from './types.js';

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * Map cosine similarity `[-1, 1]` to a non-negative weight `[0, 1]`.
 */
export function normalizedSimilarity(cos: number): number {
  return (cos + 1) / 2;
}

/**
 * Exponential decay recency weight. `halfLifeDays` defaults to 30
 * (per spec); a 30-day-old reinforcement is worth 0.5, 60 days 0.25,
 * etc.
 */
export function recencyWeight(
  lastReinforcedAt: string | null,
  now: Date,
  halfLifeDays = DEFAULT_RECENCY_HALF_LIFE_DAYS,
): number {
  if (!lastReinforcedAt) return 0;
  const then = Date.parse(lastReinforcedAt);
  if (!Number.isFinite(then)) return 0;
  const ageMs = Math.max(0, now.getTime() - then);
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/**
 * Connectivity weight via log1p(edge_count). Caps at 1.0 when
 * edge_count ≥ e^1 ≈ 2.72 (a node with three edges is "well-connected"
 * enough to hit the ceiling; finer discrimination is left to the
 * semantic and confidence terms).
 */
export function connectivityWeight(edgeCount: number): number {
  if (edgeCount <= 0) return 0;
  return Math.min(1, Math.log1p(edgeCount) / Math.log1p(10));
}

/**
 * Type-prior weight. Returns 1 if the node's type is in the filter
 * list, 0 otherwise. If the filter is empty the caller should treat
 * every node as having full type-prior weight.
 */
export function typePriorWeight(nodeType: NodeType, filter: NodeType[] | undefined): number {
  if (!filter || filter.length === 0) return 1;
  return filter.includes(nodeType) ? 1 : 0;
}

/**
 * Conflict penalty for facts. `'parked_conflict'` and `'unresolved'`
 * produce a 1.0 penalty; a fact superseded within the last 30 days
 * produces a 0.5 penalty (useful to know, but not load-bearing).
 * `'none'` → 0.
 */
export function conflictPenalty(fact: FactRow, now: Date): number {
  if (fact.conflict_status === 'parked_conflict' || fact.conflict_status === 'unresolved') {
    return 1;
  }
  if (fact.superseded_at) {
    const then = Date.parse(fact.superseded_at);
    if (Number.isFinite(then)) {
      const ageDays = (now.getTime() - then) / (1000 * 60 * 60 * 24);
      if (ageDays <= 30) return 0.5;
    }
  }
  return 0;
}

export interface NodeScoreInputs {
  node: NodeRow;
  similarity: number;
  edgeCount: number;
  weights: RankingWeights;
  halfLifeDays?: number;
  typeFilter?: NodeType[];
  now: Date;
}

export function scoreNode(inputs: NodeScoreInputs): number {
  const { node, similarity, edgeCount, weights, halfLifeDays, typeFilter, now } = inputs;
  const sim = normalizedSimilarity(similarity);
  const rec = recencyWeight(node.updated_at, now, halfLifeDays);
  const con = connectivityWeight(edgeCount);
  const type = typePriorWeight(node.type as NodeType, typeFilter);
  return (
    weights.semantic * sim +
    weights.recency * rec +
    weights.connectivity * con +
    weights.typePrior * type
  );
}

export interface FactScoreInputs {
  fact: FactRow;
  /** Similarity of the fact's subject node to the query embedding. */
  subjectSimilarity: number;
  weights: RankingWeights;
  halfLifeDays?: number;
  now: Date;
}

export function scoreFact(inputs: FactScoreInputs): number {
  const { fact, subjectSimilarity, weights, halfLifeDays, now } = inputs;
  const sim = normalizedSimilarity(subjectSimilarity);
  const rec = recencyWeight(fact.last_reinforced_at, now, halfLifeDays);
  const penalty = conflictPenalty(fact, now);
  return (
    weights.semantic * sim +
    weights.recency * rec +
    weights.confidence * fact.confidence -
    weights.conflict * penalty
  );
}
