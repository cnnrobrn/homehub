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
 *
 * Decay (M3.7-A): recency uses exponential decay with layer-specific
 * half-lives (episodic 14d, semantic 120d, procedural 365d) plus
 * per-entity-type overrides for the semantic layer (person 180d,
 * merchant 90d, place 365d, dish 120d). `defaultHalfLifeFor({layer,
 * nodeType})` exposes the resolver for callers that want to dispatch
 * the right curve themselves.
 *
 * Pattern decay: a pattern whose `last_reinforced_at` is older than
 * `PATTERN_DECAY_MULTIPLIER × natural_period` (natural period comes
 * from the pattern's `parameters.period_days`, fallback 7) is treated
 * as decayed — its recency weight drops to 0 and
 * `isPatternDecayed(pattern, now)` returns true so callers can
 * exclude it from default retrieval.
 */

import {
  DEFAULT_RECENCY_HALF_LIFE_DAYS,
  HALF_LIFE_EPISODIC_DAYS,
  HALF_LIFE_PROCEDURAL_DAYS,
  HALF_LIFE_SEMANTIC_DAYS,
  PATTERN_DECAY_MULTIPLIER,
  SEMANTIC_NODE_HALF_LIFE_DAYS,
  type FactRow,
  type NodeRow,
  type NodeType,
  type PatternRow,
  type QueryLayer,
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
 * Resolve the layer-appropriate half-life. When `layer` is `'semantic'`
 * and `nodeType` is given, use the per-type override table; otherwise
 * fall back to the layer default. When `layer` is undefined, fall
 * through to `DEFAULT_RECENCY_HALF_LIFE_DAYS` for back-compat with the
 * M3-era single-half-life call shape.
 */
export function defaultHalfLifeFor(opts: { layer?: QueryLayer; nodeType?: string }): number {
  const { layer, nodeType } = opts;
  if (layer === 'episodic') return HALF_LIFE_EPISODIC_DAYS;
  if (layer === 'procedural') return HALF_LIFE_PROCEDURAL_DAYS;
  if (layer === 'semantic') {
    if (nodeType && SEMANTIC_NODE_HALF_LIFE_DAYS[nodeType] !== undefined) {
      return SEMANTIC_NODE_HALF_LIFE_DAYS[nodeType]!;
    }
    return HALF_LIFE_SEMANTIC_DAYS;
  }
  return DEFAULT_RECENCY_HALF_LIFE_DAYS;
}

/**
 * Exponential decay recency weight:
 *
 *     weight = exp(-ln(2) * age_days / half_life)
 *            = 2 ^ (-age_days / half_life)
 *
 * reaches 0.5 at `halfLifeDays` and asymptotes toward 0. A null
 * reinforcement timestamp returns 0.
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
  if (halfLifeDays <= 0) return 0;
  return Math.exp((-Math.LN2 * ageDays) / halfLifeDays);
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

/**
 * Pattern decay check: a pattern is decayed when its last reinforcement
 * is older than `PATTERN_DECAY_MULTIPLIER × natural_period`. Natural
 * period is read from `parameters.period_days` (a number); when absent
 * we default to 7 days (weekly cadence is the most common kind HomeHub
 * detects). Decayed patterns are excluded from default retrieval and
 * their ranking recency weight is set to 0.
 */
export function isPatternDecayed(pattern: PatternRow, now: Date): boolean {
  const naturalPeriodDays = readPatternPeriodDays(pattern);
  const thresholdDays = PATTERN_DECAY_MULTIPLIER * naturalPeriodDays;
  const lastAt = Date.parse(pattern.last_reinforced_at);
  if (!Number.isFinite(lastAt)) return true;
  const ageDays = (now.getTime() - lastAt) / (1000 * 60 * 60 * 24);
  return ageDays > thresholdDays;
}

function readPatternPeriodDays(pattern: PatternRow): number {
  const params = pattern.parameters;
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    const raw = (params as Record<string, unknown>).period_days;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  }
  return 7; // weekly default
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
  // Nodes live in the semantic layer; type-specific half-lives apply
  // unless the caller explicitly overrides via `halfLifeDays`.
  const effectiveHalfLife =
    halfLifeDays ?? defaultHalfLifeFor({ layer: 'semantic', nodeType: node.type });
  const rec = recencyWeight(node.updated_at, now, effectiveHalfLife);
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
  const effectiveHalfLife = halfLifeDays ?? defaultHalfLifeFor({ layer: 'semantic' });
  const rec = recencyWeight(fact.last_reinforced_at, now, effectiveHalfLife);
  const penalty = conflictPenalty(fact, now);
  return (
    weights.semantic * sim +
    weights.recency * rec +
    weights.confidence * fact.confidence -
    weights.conflict * penalty
  );
}

export interface PatternScoreInputs {
  pattern: PatternRow;
  weights: RankingWeights;
  halfLifeDays?: number;
  now: Date;
}

/**
 * Score a procedural pattern. Decayed patterns (see
 * `isPatternDecayed`) contribute 0 recency weight — the caller should
 * additionally filter them out of default retrieval.
 */
export function scorePattern(inputs: PatternScoreInputs): number {
  const { pattern, weights, halfLifeDays, now } = inputs;
  const effectiveHalfLife = halfLifeDays ?? defaultHalfLifeFor({ layer: 'procedural' });
  const rec = isPatternDecayed(pattern, now)
    ? 0
    : recencyWeight(pattern.last_reinforced_at, now, effectiveHalfLife);
  return weights.recency * rec + weights.confidence * pattern.confidence;
}
