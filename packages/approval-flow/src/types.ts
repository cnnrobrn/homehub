/**
 * Shared types for `@homehub/approval-flow`.
 *
 * The suggestion / action shapes here are lean views of the underlying
 * `app.suggestion` and `app.action` rows. We intentionally do NOT pull
 * the full `Database['app']['Tables']['suggestion']['Row']` type through
 * the public API — the columns a consumer cares about (id, kind,
 * preview, status, ...) are stable; adding new internal columns
 * shouldn't be a breaking change in the approval-flow surface.
 */

import { type Json } from '@homehub/db';

export const SUGGESTION_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'executed',
  'expired',
  'cancelled',
] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export const ACTION_STATUSES = ['pending', 'running', 'succeeded', 'failed'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

/**
 * Canonical suggestion row view. Fields added later (e.g. `canonical_hash`,
 * `expires_at`, `approvers`) are present as optional so this package can
 * run before the migration lands; the state machine tolerates `null` on
 * all three and persists the best-effort equivalent into `preview` /
 * `app.action.payload` where it cannot write the column yet.
 */
export interface SuggestionRow {
  id: string;
  household_id: string;
  segment: string;
  kind: string;
  title: string;
  rationale: string;
  preview: Json;
  status: SuggestionStatus | string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  canonical_hash?: string | null;
  expires_at?: string | null;
  approvers?: ApprovalApprover[] | null;
}

/**
 * Canonical action row view. Mirrors `app.action`.
 */
export interface ActionRow {
  id: string;
  household_id: string;
  suggestion_id: string | null;
  segment: string;
  kind: string;
  payload: Json;
  status: ActionStatus | string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  result: Json | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One approver in the quorum list. Stored as JSON on
 * `app.suggestion.approvers` (when the column exists) or on
 * `preview.__approvers` as a fallback until then.
 */
export interface ApprovalApprover {
  memberId: string | null;
  approvedAt: string;
}

/**
 * Snapshot of an approval flow at a point in time.
 */
export interface ApprovalState {
  suggestion: SuggestionRow;
  approvers: ApprovalApprover[];
  quorumMet: boolean;
  eligibleToExecute: boolean;
}
