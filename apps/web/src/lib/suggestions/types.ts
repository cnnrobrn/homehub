/**
 * Shared types for the unified suggestions surface.
 *
 * Camel-cased view over `app.suggestion` + `app.action` that the
 * `/suggestions` page, SuggestionApprovalPill, and approval server
 * actions all consume. Keeps the DB row shape out of React props.
 */

export type SuggestionSegment = 'financial' | 'food' | 'fun' | 'social' | 'system';

export type SuggestionStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'expired';

export interface SuggestionApproverView {
  memberId: string | null;
  memberName: string | null;
  approvedAt: string;
}

export interface SuggestionRowView {
  id: string;
  householdId: string;
  segment: SuggestionSegment | string;
  kind: string;
  title: string;
  rationale: string;
  status: SuggestionStatus | string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByMemberId: string | null;
  resolvedByMemberName: string | null;
  preview: Record<string, unknown>;
  approvers: SuggestionApproverView[];
  /** True when `policy.requiresQuorum <= approvers.length`. */
  quorumMet: boolean;
  /** Total members required for the policy (>= 1). */
  requiresQuorum: number;
}

export interface SuggestionDetailView extends SuggestionRowView {
  /** The action row, if any has been dispatched for this suggestion. */
  action: {
    id: string;
    status: string;
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
  } | null;
  /** Preview of an originating alert (when a suggestion was drafted from an alert). */
  alertContext: Record<string, unknown> | null;
  /** Optional evidence list (evidence drawer source rows). */
  evidence: Array<Record<string, unknown>>;
}
