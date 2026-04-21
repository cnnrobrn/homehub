/**
 * `@homehub/approval-flow` — the approval state machine + policy
 * evaluator + audit writer.
 *
 * Consumers:
 *   - `apps/workers/action-executor` — runs the executor side of the
 *     state machine: transitions action status, verifies tamper hash,
 *     dispatches to kind-keyed executors.
 *   - `packages/auth-server/src/approval/actions.ts` — wraps the
 *     primitives as server actions for `apps/web`.
 *   - `packages/suggestions` / the suggestions worker — enqueue
 *     auto-approval evaluation messages when new suggestions land.
 *
 * This package does NOT:
 *   - Call providers (that's M9-B / `@integrations`).
 *   - Render UI (that's M9-C / `@frontend-chat`).
 *   - Author migrations (schema changes are requested via `@infra-platform`).
 */

export { ApprovalError, type ApprovalErrorCode } from './errors.js';

export {
  SUGGESTION_STATUSES,
  ACTION_STATUSES,
  type SuggestionStatus,
  type ActionStatus,
  type SuggestionRow,
  type ActionRow,
  type ApprovalApprover,
  type ApprovalState,
} from './types.js';

export { canonicalHash, canonicalJson, type CanonicalHashInput } from './canonical-hash.js';

export {
  AUTO_APPROVAL_DENY_LIST,
  DEFAULT_POLICIES,
  getPolicyFor,
  type ApprovalPolicy,
  type ApprovalSettings,
  type PolicyEvaluationContext,
} from './policies.js';

export {
  AUDIT_ACTIONS,
  writeApprovalAudit,
  type ApprovalAuditAction,
  type ApprovalAuditInput,
  type AuditLogger,
} from './audit.js';

export {
  ACTION_SUGGESTION_HASH_KEY,
  approveSuggestion,
  dispatchAction,
  extractApprovers,
  getApprovalState,
  rejectSuggestion,
  transitionAction,
  type ApproveArgs,
  type ApprovalFlowDeps,
  type DispatchArgs,
  type DispatchResult,
  type RejectArgs,
  type TransitionDetail,
} from './state-machine.js';
