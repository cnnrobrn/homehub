/**
 * Executor for the `forget_fact` action kind.
 *
 * Member-approved soft-delete of a canonical fact. Mirrors the M3.5-B
 * path: write a `mem.fact_candidate` with `source='member'`,
 * `object_value=null`, `valid_to=now`; the reconciler's case-0 branch
 * closes the canonical's validity interval without writing a
 * successor. See `packages/enrichment/src/reconciler/reconcile.ts`
 * for the deletion semantics.
 */

import { reconcileCandidate } from '@homehub/enrichment';
import { z } from 'zod';

import { coerceRecord, PermanentExecutorError, toPayloadInvalidError } from '../errors.js';
import { type ActionExecutor, type ExecutorDeps } from '../types.js';

export const forgetFactPayloadSchema = z.object({
  subject_node_id: z.string().uuid(),
  predicate: z.string().min(1),
  evidence: z.record(z.string(), z.unknown()).optional(),
});

export type ForgetFactPayload = z.infer<typeof forgetFactPayloadSchema>;

export interface CreateForgetFactExecutorArgs {
  supabase: ExecutorDeps['supabase'];
  now?: () => Date;
}

export function createForgetFactExecutor(deps: CreateForgetFactExecutorArgs): ActionExecutor {
  const now = deps.now ?? (() => new Date());
  return async ({ action, suggestion, log }) => {
    const payloadCandidate = {
      ...coerceRecord(suggestion.preview),
      ...coerceRecord(action.payload),
    };
    let payload: ForgetFactPayload;
    try {
      payload = forgetFactPayloadSchema.parse(payloadCandidate);
    } catch (err) {
      throw toPayloadInvalidError(err);
    }

    const stamp = now().toISOString();

    const { data: candidate, error: insErr } = await deps.supabase
      .schema('mem')
      .from('fact_candidate')
      .insert({
        household_id: action.household_id,
        subject_node_id: payload.subject_node_id,
        predicate: payload.predicate,
        // Soft-delete signature recognized by the reconciler:
        //   object_value=null + valid_to=now + source='member'.
        object_value: null,
        source: 'member',
        confidence: 1,
        recorded_at: stamp,
        valid_from: stamp,
        valid_to: stamp,
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

    log.info('forget_fact reconciled', {
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
