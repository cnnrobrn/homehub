/**
 * Executor for the `propose_transfer` action kind.
 *
 * YNAB is read-only ("no writes to upstream" per
 * `specs/03-integrations/budgeting.md`) so this executor is
 * **intent-only**:
 *
 *   1. Write an `audit.event` describing the transfer the member
 *      approved (so operators and the household audit browser can
 *      trace the request).
 *   2. Write a `mem.episode` so the household's memory reflects the
 *      intent ("we approved a $500 transfer from Chase Checking to
 *      the emergency fund on 2026-04-20").
 *   3. Return a sentinel result telling the UI "execute manually in
 *      your bank / budgeting app".
 *
 * No provider call. No external side effect. The approval chain
 * enforces that destructive kinds require a human tap, so this
 * intent is always member-authored.
 */

import { type Json } from '@homehub/db';
import { z } from 'zod';

import { coerceRecord, PermanentExecutorError, toPayloadInvalidError } from '../errors.js';
import { type ActionExecutor, type ExecutorDeps } from '../types.js';

export const proposeTransferPayloadSchema = z.object({
  from_account: z.string().min(1),
  to_account: z.string().min(1),
  amount_cents: z.number().int().positive(),
  currency: z.string().default('USD'),
  reason: z.string().optional(),
});

export type ProposeTransferPayload = z.infer<typeof proposeTransferPayloadSchema>;

export interface CreateProposeTransferExecutorArgs {
  supabase: ExecutorDeps['supabase'];
  now?: () => Date;
}

const MANUAL_GUIDANCE = 'HomeHub tracks the intent; execute manually in your bank/budgeting app.';

export function createProposeTransferExecutor(
  deps: CreateProposeTransferExecutorArgs,
): ActionExecutor {
  const now = deps.now ?? (() => new Date());
  return async ({ action, suggestion, log }) => {
    const payloadCandidate = {
      ...coerceRecord(suggestion.preview),
      ...coerceRecord(action.payload),
    };
    let payload: ProposeTransferPayload;
    try {
      payload = proposeTransferPayloadSchema.parse(payloadCandidate);
    } catch (err) {
      throw toPayloadInvalidError(err);
    }

    const stamp = now().toISOString();
    const description =
      `Approved transfer: ${payload.from_account} → ${payload.to_account}, ` +
      `${payload.amount_cents / 100} ${payload.currency}` +
      (payload.reason ? ` (${payload.reason})` : '');

    // 1. audit.event — operators can filter on action='financial.transfer.logged'.
    const { error: auditErr } = await deps.supabase
      .schema('audit')
      .from('event')
      .insert({
        household_id: action.household_id,
        actor_user_id: null,
        action: 'financial.transfer.logged',
        resource_type: 'app.action',
        resource_id: action.id,
        before: null,
        after: {
          from_account: payload.from_account,
          to_account: payload.to_account,
          amount_cents: payload.amount_cents,
          currency: payload.currency,
          reason: payload.reason ?? null,
        } as unknown as Json,
      });
    if (auditErr) {
      // Audit failure is a permanent programmer bug — the action already
      // transitioned to running. DLQ so operators notice.
      throw new PermanentExecutorError(
        'audit_write_failed',
        `audit.event insert failed: ${auditErr.message}`,
      );
    }

    // 2. mem.episode — puts the intent into the household's memory so
    // future queries ("did we already approve that transfer?") can
    // answer without reading audit logs.
    const { error: episodeErr } = await deps.supabase
      .schema('mem')
      .from('episode')
      .insert({
        household_id: action.household_id,
        title: description,
        summary: payload.reason ?? null,
        occurred_at: stamp,
        source_id: action.id,
        source_type: 'financial.transfer.logged',
        metadata: {
          from_account: payload.from_account,
          to_account: payload.to_account,
          amount_cents: payload.amount_cents,
          currency: payload.currency,
        } as unknown as Json,
      });
    if (episodeErr) {
      throw new PermanentExecutorError(
        'episode_write_failed',
        `mem.episode insert failed: ${episodeErr.message}`,
      );
    }

    log.info('propose_transfer logged', {
      from: payload.from_account,
      to: payload.to_account,
      amount_cents: payload.amount_cents,
    });

    return {
      result: {
        status: 'logged',
        note: MANUAL_GUIDANCE,
        audited: true,
      },
    };
  };
}
