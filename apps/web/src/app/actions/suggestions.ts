/**
 * Server actions for the unified suggestions UI.
 *
 * Every action is a thin wrapper around `@homehub/auth-server`'s
 * `approveSuggestionAction` / `rejectSuggestionAction` /
 * `getApprovalStateAction`. The wrapper layer exists because:
 *
 *   - Next.js Server Actions need a `'use server'` boundary, Zod
 *     validation at that boundary, and the `ActionResult` envelope.
 *   - The underlying `@homehub/auth-server` helpers throw
 *     `AuthServerError` subclasses; the `ActionResult` envelope
 *     translates those via `toErr`.
 *   - Tests + callers only need to import from `@/app/actions/...`
 *     — they never touch the package directly.
 *
 * These three actions are the single path for approvals from the UI
 * post-M9-C. Segment-specific actions (`approveOutingIdeaAction`,
 * `approveGroceryDraftAction`, `approveReachOutAction`,
 * `rejectGroceryDraftAction`) now delegate to the underlying
 * `approveSuggestionAction` so the state machine owns the transition.
 *
 * The previous segment-specific actions remain callable with their
 * old signatures for backwards compatibility. They now return
 * `suggestionId` + the suggestion's post-approval status instead of
 * side-effecting a paired `app.event` / `app.grocery_list` insert —
 * those side effects are handled by M9-B's action executor after
 * dispatch.
 */

'use server';

import { type ApprovalState } from '@homehub/approval-flow';
import {
  approveSuggestionAction as coreApproveSuggestionAction,
  getApprovalStateAction as coreGetApprovalStateAction,
  rejectSuggestionAction as coreRejectSuggestionAction,
} from '@homehub/auth-server';
import { z } from 'zod';

import { type ActionResult, ok, toErr } from './_envelope';

import { nextCookieAdapter } from '@/lib/auth/cookies';
import { authEnv } from '@/lib/auth/env';

const suggestionIdSchema = z.object({
  suggestionId: z.string().uuid(),
});

const rejectSchema = suggestionIdSchema.extend({
  reason: z.string().max(500).optional(),
});

export interface ApprovalStateSummary {
  suggestionId: string;
  status: string;
  approvers: Array<{
    memberId: string | null;
    approvedAt: string;
  }>;
  quorumMet: boolean;
  eligibleToExecute: boolean;
}

function toSummary(state: ApprovalState): ApprovalStateSummary {
  return {
    suggestionId: state.suggestion.id,
    status: state.suggestion.status,
    approvers: state.approvers.map((a: ApprovalState['approvers'][number]) => ({
      memberId: a.memberId,
      approvedAt: a.approvedAt,
    })),
    quorumMet: state.quorumMet,
    eligibleToExecute: state.eligibleToExecute,
  };
}

/**
 * Approve a suggestion via the state-machine-owned path. Returns the
 * resulting approval state so UIs can render quorum progress.
 */
export async function approveSuggestionViaQueueAction(
  input: z.input<typeof suggestionIdSchema>,
): Promise<ActionResult<ApprovalStateSummary>> {
  try {
    const parsed = suggestionIdSchema.parse(input);
    const cookies = await nextCookieAdapter();
    const state = await coreApproveSuggestionAction({
      env: authEnv(),
      cookies,
      suggestionId: parsed.suggestionId,
    });
    return ok(toSummary(state));
  } catch (err) {
    return toErr(err);
  }
}

/**
 * Reject a suggestion. The optional reason is persisted to the
 * `suggestion.rejected` audit event.
 */
export async function rejectSuggestionViaQueueAction(
  input: z.input<typeof rejectSchema>,
): Promise<ActionResult<{ suggestionId: string }>> {
  try {
    const parsed = rejectSchema.parse(input);
    const cookies = await nextCookieAdapter();
    await coreRejectSuggestionAction({
      env: authEnv(),
      cookies,
      suggestionId: parsed.suggestionId,
      ...(parsed.reason ? { reason: parsed.reason } : {}),
    });
    return ok({ suggestionId: parsed.suggestionId });
  } catch (err) {
    return toErr(err);
  }
}

/**
 * Read-only view of a suggestion's approval state. Used by the
 * suggestions page + approval pill to render quorum progress.
 */
export async function getSuggestionApprovalStateAction(
  input: z.input<typeof suggestionIdSchema>,
): Promise<ActionResult<ApprovalStateSummary>> {
  try {
    const parsed = suggestionIdSchema.parse(input);
    const cookies = await nextCookieAdapter();
    const state = await coreGetApprovalStateAction({
      env: authEnv(),
      cookies,
      suggestionId: parsed.suggestionId,
    });
    return ok(toSummary(state));
  } catch (err) {
    return toErr(err);
  }
}
