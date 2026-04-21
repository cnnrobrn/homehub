/**
 * Error class for approval-flow failures.
 *
 * Every failure that the state machine detects carries a stable `code`
 * so callers (server actions, the action-executor worker) can branch on
 * it without parsing the message text:
 *
 *   - `NOT_FOUND`           the suggestion / action row does not exist.
 *   - `ALREADY_FINALIZED`   caller tried to approve/reject a suggestion
 *                           that was already resolved (approved, rejected,
 *                           executed, expired, or cancelled).
 *   - `QUORUM_NOT_MET`      the policy requires more approvers than have
 *                           tapped yet. This is not an error per se but
 *                           lets callers differentiate from other failures.
 *   - `TAMPER_DETECTED`     the canonical hash of the suggestion preview
 *                           no longer matches the hash stored on the
 *                           action when the executor is about to run.
 *   - `FORBIDDEN`           the actor lacks rights for this segment or
 *                           the policy disallows this approver (e.g.
 *                           auto-approving a destructive kind).
 */

export type ApprovalErrorCode =
  | 'NOT_FOUND'
  | 'ALREADY_FINALIZED'
  | 'QUORUM_NOT_MET'
  | 'TAMPER_DETECTED'
  | 'FORBIDDEN';

export class ApprovalError extends Error {
  readonly code: ApprovalErrorCode;

  constructor(message: string, code: ApprovalErrorCode, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ApprovalError';
    this.code = code;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}
