/**
 * Reconciler — promotes `mem.fact_candidate` rows into canonical
 * `mem.fact` per the policy in
 * `specs/04-memory-network/extraction.md` and
 * `specs/04-memory-network/conflict-resolution.md`.
 *
 * Outcomes per candidate (see `ReconcileOutcome`):
 *   - `promoted`      — inserted a new canonical mem.fact.
 *   - `reinforced`    — incremented reinforcement_count on an existing
 *                       canonical that already agreed.
 *   - `conflict`      — ran the conflict policy; winner either
 *                       superseded the other or was parked.
 *   - `parked`        — candidate stays pending (low confidence, no
 *                       canonical to compare to).
 *   - `rejected`      — candidate declared invalid (missing subject).
 *
 * Each reconcile call is a single Supabase transaction-analog: we
 * issue the sequence of mutations ourselves and fail loudly on any
 * mutation error. Supabase-js doesn't surface explicit transactions
 * over PostgREST, so we pass a `transactional` flag that callers can
 * flip on to use a wrapping RPC. For M3-B we use sequential mutations
 * with cleanup on error — the reconciler runs per candidate so the
 * blast radius of a mid-flight error is one candidate row; the
 * candidate stays `pending` and the next reconciler pass retries.
 *
 * Bi-temporal contract: we NEVER overwrite a canonical fact. A
 * supersession sets `valid_to`, `superseded_at`, `superseded_by` on
 * the old row and inserts a NEW row for the new fact. Readers asking
 * "what was true on 2026-03-01" (as_of) walk back through the chain.
 */

import { type Database, type Json } from '@homehub/db';
import { type Logger } from '@homehub/worker-runtime';
import { type SupabaseClient } from '@supabase/supabase-js';

import {
  decideConflict,
  jsonEqual,
  CONFIDENCE_CAP,
  REINFORCEMENT_BUMP,
  policyFor,
} from './policy.js';

export type ReconcileOutcome = 'promoted' | 'reinforced' | 'conflict' | 'parked' | 'rejected';

type CandidateRow = Database['mem']['Tables']['fact_candidate']['Row'];
type FactRow = Database['mem']['Tables']['fact']['Row'];

export interface ReconcileResult {
  outcome: ReconcileOutcome;
  factId?: string;
  candidateId: string;
  reason: string;
  /** Nodes the worker should enqueue for `node_regen` after this reconcile. */
  touchedNodeIds: string[];
}

export interface ReconcileDeps {
  supabase: SupabaseClient<Database>;
  log: Logger;
  /** Defaults to `() => new Date()`. Tests override. */
  now?: () => Date;
}

/**
 * Reconcile a single `mem.fact_candidate` row. Returns the outcome
 * and any node ids that should be regenerated.
 */
export async function reconcileCandidate(
  deps: ReconcileDeps,
  candidateId: string,
): Promise<ReconcileResult> {
  const { supabase, log } = deps;
  const now = (deps.now ?? (() => new Date()))();

  const { data: candidate, error: loadErr } = await supabase
    .schema('mem')
    .from('fact_candidate')
    .select('*')
    .eq('id', candidateId)
    .maybeSingle();
  if (loadErr) {
    throw new Error(`reconcile: candidate load failed: ${loadErr.message}`);
  }
  if (!candidate) {
    return {
      outcome: 'rejected',
      candidateId,
      reason: 'candidate_not_found',
      touchedNodeIds: [],
    };
  }

  // Reject candidates missing the minimum shape. The extractor should
  // never produce these, but defense in depth — the DB schema lets
  // fact_candidate have a null subject_node_id, and we refuse to
  // promote those.
  if (!candidate.subject_node_id) {
    await updateCandidate(supabase, candidateId, {
      status: 'rejected',
      reason: 'missing_subject_node_id',
    });
    return {
      outcome: 'rejected',
      candidateId,
      reason: 'missing_subject_node_id',
      touchedNodeIds: [],
    };
  }
  if (candidate.confidence == null) {
    await updateCandidate(supabase, candidateId, {
      status: 'rejected',
      reason: 'missing_confidence',
    });
    return {
      outcome: 'rejected',
      candidateId,
      reason: 'missing_confidence',
      touchedNodeIds: [],
    };
  }

  const predicate = candidate.predicate;
  const policy = policyFor(predicate);
  const touched = new Set<string>();
  touched.add(candidate.subject_node_id);
  if (candidate.object_node_id) touched.add(candidate.object_node_id);

  // Look up the current canonical fact for this (household, subject,
  // predicate) — the partial index `mem_fact_current_idx` makes this
  // cheap.
  const { data: canonicalRows, error: canonErr } = await supabase
    .schema('mem')
    .from('fact')
    .select('*')
    .eq('household_id', candidate.household_id)
    .eq('subject_node_id', candidate.subject_node_id)
    .eq('predicate', predicate)
    .is('valid_to', null)
    .is('superseded_at', null)
    .limit(2);
  if (canonErr) {
    throw new Error(`reconcile: canonical lookup failed: ${canonErr.message}`);
  }

  const canonical = (canonicalRows ?? [])[0];

  // -------------------------------------------------------------------
  // Case 1 — no canonical row: maybe promote.
  // -------------------------------------------------------------------
  if (!canonical) {
    if (candidate.confidence < policy.threshold) {
      // Keep pending; reinforcement later may flip us over the bar.
      log.debug('reconcile: candidate below threshold; keeping pending', {
        candidate_id: candidateId,
        predicate,
        confidence: candidate.confidence,
        threshold: policy.threshold,
      });
      return {
        outcome: 'parked',
        candidateId,
        reason: 'below_threshold',
        touchedNodeIds: [],
      };
    }

    const factId = await insertCanonicalFact(supabase, candidate, now);
    await updateCandidate(supabase, candidateId, {
      status: 'promoted',
      promoted_fact_id: factId,
      reason: 'new_fact_promoted',
    });

    if (policy.setNeedsReview) {
      await markNodeNeedsReview(supabase, candidate.subject_node_id);
    }

    log.info('reconcile: promoted new canonical fact', {
      candidate_id: candidateId,
      fact_id: factId,
      predicate,
    });

    return {
      outcome: 'promoted',
      factId,
      candidateId,
      reason: policy.setNeedsReview ? 'promoted_needs_review' : 'promoted',
      touchedNodeIds: Array.from(touched),
    };
  }

  // -------------------------------------------------------------------
  // Case 2 — canonical exists, same object: reinforcement.
  // -------------------------------------------------------------------
  const sameObject =
    jsonEqual(canonical.object_value ?? null, candidate.object_value ?? null) &&
    (canonical.object_node_id ?? null) === (candidate.object_node_id ?? null);

  if (sameObject) {
    const nextConfidence = Math.min(
      CONFIDENCE_CAP,
      Math.max(canonical.confidence, candidate.confidence) + REINFORCEMENT_BUMP,
    );
    const { error: upErr } = await supabase
      .schema('mem')
      .from('fact')
      .update({
        reinforcement_count: canonical.reinforcement_count + 1,
        last_reinforced_at: now.toISOString(),
        confidence: nextConfidence,
      })
      .eq('id', canonical.id);
    if (upErr) {
      throw new Error(`reconcile: canonical reinforcement update failed: ${upErr.message}`);
    }
    await updateCandidate(supabase, candidateId, {
      status: 'promoted',
      promoted_fact_id: canonical.id,
      reason: 'reinforced_canonical',
    });
    log.info('reconcile: reinforced canonical fact', {
      candidate_id: candidateId,
      fact_id: canonical.id,
      predicate,
    });
    return {
      outcome: 'reinforced',
      factId: canonical.id,
      candidateId,
      reason: 'reinforced_canonical',
      touchedNodeIds: Array.from(touched),
    };
  }

  // -------------------------------------------------------------------
  // Case 3 — canonical exists, different object: conflict policy.
  // -------------------------------------------------------------------
  const decision = decideConflict({
    canonical: {
      source: canonical.source,
      confidence: canonical.confidence,
      reinforcementCount: canonical.reinforcement_count,
      lastReinforcedAt: canonical.last_reinforced_at,
    },
    candidate: {
      source: candidate.source,
      confidence: candidate.confidence,
    },
    predicate,
  });

  if (decision.winner === 'candidate') {
    // Candidate wins: supersede the canonical, insert a new canonical.
    const newFactId = await insertCanonicalFact(supabase, candidate, now);
    const { error: supErr } = await supabase
      .schema('mem')
      .from('fact')
      .update({
        valid_to: now.toISOString(),
        superseded_at: now.toISOString(),
        superseded_by: newFactId,
      })
      .eq('id', canonical.id);
    if (supErr) {
      // Roll back the new canonical insert. Best effort; the next
      // reconciler pass will detect the orphaned new row and re-
      // supersede.
      await supabase.schema('mem').from('fact').delete().eq('id', newFactId);
      throw new Error(`reconcile: supersede update failed: ${supErr.message}`);
    }
    await updateCandidate(supabase, candidateId, {
      status: 'promoted',
      promoted_fact_id: newFactId,
      reason: `conflict_won:${decision.rule}`,
    });
    if (policy.setNeedsReview) {
      await markNodeNeedsReview(supabase, candidate.subject_node_id);
    }
    log.info('reconcile: candidate superseded canonical', {
      candidate_id: candidateId,
      old_fact_id: canonical.id,
      new_fact_id: newFactId,
      rule: decision.rule,
    });
    return {
      outcome: 'conflict',
      factId: newFactId,
      candidateId,
      reason: `won:${decision.rule}`,
      touchedNodeIds: Array.from(touched),
    };
  }

  if (decision.winner === 'canonical') {
    // Canonical wins: reject the candidate.
    await updateCandidate(supabase, candidateId, {
      status: 'rejected',
      reason: `conflict_lost:${decision.rule}`,
    });
    return {
      outcome: 'conflict',
      factId: canonical.id,
      candidateId,
      reason: `lost:${decision.rule}`,
      touchedNodeIds: [],
    };
  }

  // Park: flag both for member review.
  const { error: flagErr } = await supabase
    .schema('mem')
    .from('fact')
    .update({ conflict_status: 'parked_conflict' })
    .eq('id', canonical.id);
  if (flagErr) {
    throw new Error(`reconcile: parked_conflict flag failed: ${flagErr.message}`);
  }
  await updateCandidate(supabase, candidateId, {
    status: 'parked',
    reason: `parked:${decision.rule}`,
  });
  if (policy.setNeedsReview) {
    await markNodeNeedsReview(supabase, candidate.subject_node_id);
  }
  log.info('reconcile: conflict parked for member review', {
    candidate_id: candidateId,
    fact_id: canonical.id,
    rule: decision.rule,
  });
  return {
    outcome: 'conflict',
    factId: canonical.id,
    candidateId,
    reason: `parked:${decision.rule}`,
    touchedNodeIds: Array.from(touched),
  };
}

// ---- Helpers ------------------------------------------------------------

async function insertCanonicalFact(
  supabase: SupabaseClient<Database>,
  candidate: CandidateRow,
  now: Date,
): Promise<string> {
  const validFrom = candidate.valid_from ?? now.toISOString();
  const insert: Database['mem']['Tables']['fact']['Insert'] = {
    household_id: candidate.household_id,
    subject_node_id: candidate.subject_node_id!,
    predicate: candidate.predicate,
    object_value: (candidate.object_value ?? null) as Json,
    object_node_id: candidate.object_node_id ?? null,
    confidence: candidate.confidence ?? 0,
    evidence: candidate.evidence ?? [],
    valid_from: validFrom,
    recorded_at: candidate.recorded_at,
    source: candidate.source,
    reinforcement_count: 1,
    last_reinforced_at: now.toISOString(),
    conflict_status: 'none',
  };
  const { data, error } = await supabase
    .schema('mem')
    .from('fact')
    .insert(insert)
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`reconcile: fact insert failed: ${error?.message ?? 'no data'}`);
  }
  return data.id as string;
}

async function updateCandidate(
  supabase: SupabaseClient<Database>,
  id: string,
  patch: Partial<Database['mem']['Tables']['fact_candidate']['Update']>,
): Promise<void> {
  const { error } = await supabase.schema('mem').from('fact_candidate').update(patch).eq('id', id);
  if (error) {
    throw new Error(`reconcile: candidate update failed (${id}): ${error.message}`);
  }
}

async function markNodeNeedsReview(
  supabase: SupabaseClient<Database>,
  nodeId: string,
): Promise<void> {
  const { error } = await supabase
    .schema('mem')
    .from('node')
    .update({ needs_review: true })
    .eq('id', nodeId);
  if (error) {
    // Not fatal — the candidate still promoted. Log via throwing here
    // would roll back the worker's pass; log at worker level instead.
    throw new Error(`reconcile: node needs_review flag failed (${nodeId}): ${error.message}`);
  }
}

/** Exposed for tests so we can assert on the shape of a fact row. */
export type { FactRow, CandidateRow };
