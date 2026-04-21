/**
 * Reconciler policy — confidence thresholds, destructive predicates,
 * and the provenance-weighted conflict policy from
 * `specs/04-memory-network/conflict-resolution.md`.
 */

/**
 * Predicates where getting it wrong is destructive (health, privacy,
 * identity). These require a higher confidence bar (0.9) to promote
 * and set `needs_review=true` on the subject node so the household
 * confirms before the assistant trusts the fact.
 */
export const DESTRUCTIVE_PREDICATES = new Set([
  'avoids',
  'allergic_to',
  'lives_at',
  'has_birthday',
  'born_on',
  'works_at',
  'has_medical_condition',
]);

/**
 * Standard confidence bar for non-destructive predicates. A candidate
 * below this confidence stays in `mem.fact_candidate` and does not
 * enter canonical memory until it's reinforced past the threshold.
 */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

/** Destructive-predicate confidence bar. */
export const DESTRUCTIVE_CONFIDENCE_THRESHOLD = 0.9;

/** Confidence cap applied after reinforcement bumps. */
export const CONFIDENCE_CAP = 0.99;

/** Reinforcement bump per repeat observation. Spec leaves this
 * tunable — start small so we don't flip to 0.99 after two mentions. */
export const REINFORCEMENT_BUMP = 0.03;

export interface PredicatePolicy {
  /** Confidence bar the candidate must clear to promote. */
  threshold: number;
  /** Whether the subject node should be marked `needs_review=true`
   * when this fact promotes. */
  setNeedsReview: boolean;
  /** Whether this predicate can auto-supersede a canonical fact. When
   * false, conflicts are parked for member review (per
   * conflict-resolution.md Rule 4). */
  allowAutoSupersede: boolean;
}

export function policyFor(predicate: string): PredicatePolicy {
  if (DESTRUCTIVE_PREDICATES.has(predicate)) {
    return {
      threshold: DESTRUCTIVE_CONFIDENCE_THRESHOLD,
      setNeedsReview: true,
      allowAutoSupersede: false,
    };
  }
  return {
    threshold: DEFAULT_CONFIDENCE_THRESHOLD,
    setNeedsReview: false,
    allowAutoSupersede: true,
  };
}

/**
 * Compares two JSON values for deep equality. Used to decide whether
 * a candidate is a reinforcement (same object) or a conflict
 * (different object). Handles primitives, plain objects, and arrays.
 * Not cycle-safe — memory-graph objects are small trees, not graphs.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!jsonEqual(a[i], b[i])) return false;
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao).sort();
  const bKeys = Object.keys(bo).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i += 1) {
    if (aKeys[i] !== bKeys[i]) return false;
    const k = aKeys[i]!;
    if (!jsonEqual(ao[k], bo[k])) return false;
  }
  return true;
}

export interface ConflictDecisionInput {
  canonical: {
    source: string;
    confidence: number;
    reinforcementCount: number;
    lastReinforcedAt: string;
  };
  candidate: {
    source: string;
    confidence: number;
  };
  predicate: string;
}

export type ConflictWinner = 'canonical' | 'candidate' | 'park';

/**
 * Apply the conflict-resolution policy from
 * `specs/04-memory-network/conflict-resolution.md`, in fixed order.
 * First matching rule wins.
 */
export function decideConflict(input: ConflictDecisionInput): {
  winner: ConflictWinner;
  rule: string;
} {
  const { canonical, candidate, predicate } = input;
  const policy = policyFor(predicate);

  // Rule 4 — destructive predicates never auto-supersede.
  if (!policy.allowAutoSupersede) {
    return { winner: 'park', rule: 'destructive_predicate_requires_confirmation' };
  }

  // Rule 1 — member-written canonical beats model-inferred candidate.
  if (canonical.source === 'member' && candidate.source !== 'member') {
    return { winner: 'park', rule: 'member_written_canonical_beats_inferred' };
  }

  // Rule 2 — high-confidence explicit candidate supersedes low-
  // confidence inferred canonical. "Explicit" here means the
  // candidate was sourced from a member entry or a direct extraction
  // (not a consolidation or reflection guess).
  const candidateIsExplicit = candidate.source === 'member' || candidate.source === 'extraction';
  if (
    candidate.confidence >= 0.9 &&
    candidateIsExplicit &&
    canonical.source !== 'member' &&
    canonical.confidence < 0.7
  ) {
    return { winner: 'candidate', rule: 'high_confidence_explicit_beats_low_inferred' };
  }

  // Rule 3 — reinforcement-threshold supersession. A new candidate
  // can flip the canonical only when it carries at least one explicit
  // source OR 3 independent observations. We don't yet have an
  // "observations" count pre-reconciliation, so we approximate:
  // a single high-confidence explicit candidate is enough.
  if (candidateIsExplicit && candidate.confidence >= 0.8) {
    return { winner: 'candidate', rule: 'explicit_candidate_with_sufficient_confidence' };
  }

  // Rule 5 — park.
  return { winner: 'park', rule: 'parked_unresolved' };
}
