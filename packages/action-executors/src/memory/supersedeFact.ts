/**
 * Executor for the `supersede_fact` action kind.
 *
 * Member-approved fact edit. We write a `mem.fact_candidate` with
 * `source='member'` + the new `object_value`, then invoke
 * `reconcileCandidate` inline — the reconciler is responsible for the
 * bi-temporal supersession (close the old canonical's interval, insert
 * a new one). See `specs/04-memory-network/conflict-resolution.md`.
 */

import { reconcileCandidate } from '@homehub/enrichment';
import { z } from 'zod';

import { coerceRecord, PermanentExecutorError, toPayloadInvalidError } from '../errors.js';
import { type ActionExecutor, type ExecutorDeps } from '../types.js';

export const supersedeFactPayloadSchema = z.object({
  subject_node_id: z.string().uuid(),
  predicate: z.string().min(1),
  new_object_value: z.unknown(),
  new_object_node_id: z.string().uuid().optional().nullable(),
  valid_from: z.string().optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
});

export type SupersedeFactPayload = z.infer<typeof supersedeFactPayloadSchema>;

export interface CreateSupersedeFactExecutorArgs {
  supabase: ExecutorDeps['supabase'];
  now?: () => Date;
}

export function createSupersedeFactExecutor(deps: CreateSupersedeFactExecutorArgs): ActionExecutor {
  const now = deps.now ?? (() => new Date());
  return async ({ action, suggestion, log }) => {
    const payloadCandidate = {
      ...coerceRecord(suggestion.preview),
      ...coerceRecord(action.payload),
    };
    let payload: SupersedeFactPayload;
    try {
      payload = supersedeFactPayloadSchema.parse(payloadCandidate);
    } catch (err) {
      throw toPayloadInvalidError(err);
    }

    const recordedAt = now().toISOString();

    const { data: candidate, error: insErr } = await deps.supabase
      .schema('mem')
      .from('fact_candidate')
      .insert({
        household_id: action.household_id,
        subject_node_id: payload.subject_node_id,
        predicate: payload.predicate,
        object_value: payload.new_object_value as never,
        object_node_id: payload.new_object_node_id ?? null,
        source: 'member',
        // Member-sourced facts land at the ceiling confidence the
        // reconciler's policy enforces for non-destructive predicates.
        confidence: 0.95,
        recorded_at: recordedAt,
        valid_from: payload.valid_from ?? recordedAt,
        evidence: (payload.evidence as never) ?? { member_approved_action_id: action.id },
        status: 'pending',
      })
      .select('id')
      .single();

    if (insErr || !candidate) {
      throw new Error(`mem.fact_candidate insert failed: ${insErr?.message ?? 'no row returned'}`);
    }

    const candidateId = (candidate as { id: string }).id;
    if (!candidateId) {
      throw new PermanentExecutorError(
        'candidate_insert_missing_id',
        'mem.fact_candidate insert did not return an id',
      );
    }

    const result = await reconcileCandidate({ supabase: deps.supabase, log, now }, candidateId);

    log.info('supersede_fact reconciled', {
      candidate_id: candidateId,
      outcome: result.outcome,
      fact_id: result.factId ?? null,
    });

    return {
      result: {
        candidate_id: candidateId,
        fact_id: result.factId ?? null,
        outcome: result.outcome,
        reason: result.reason,
      },
    };
  };
}
