/**
 * `<SuggestionApprovalPill />` — shared Approve / Reject surface.
 *
 * Used in:
 *   - the unified `/suggestions` page,
 *   - every segment's inline pending-suggestion card
 *     (`GroceryListsView`, `OutingSuggestionCard`, `FinancialAlertsFeed`,
 *     `PersonDetail`, `FactRow`),
 *   - the chat's inline tool-result cards for `draft-write` outputs.
 *
 * Client island. Announces state transitions via `aria-live='polite'`;
 * the Approve / Reject buttons are keyboard-reachable focus targets.
 *
 * When `quorum > 1` the row renders a "M of N approvers" pip plus
 * avatar initials so members can see at a glance whether their
 * approval will finalize the suggestion.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  approveSuggestionViaQueueAction,
  rejectSuggestionViaQueueAction,
} from '@/app/actions/suggestions';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { cn } from '@/lib/cn';

export interface SuggestionApprovalPillApprover {
  memberId: string | null;
  memberName: string | null;
  approvedAt: string;
}

export interface SuggestionApprovalPillProps {
  suggestionId: string;
  status: string;
  requiresQuorum: number;
  approvers: readonly SuggestionApprovalPillApprover[];
  /**
   * Optional: when the pill is used inline next to a card that already
   * shows the preview, pass `size='sm'` to render compact buttons.
   */
  size?: 'default' | 'sm';
  /**
   * Optional custom labels — useful when the caller wants segment-specific
   * copy (e.g. "Approve outing" instead of plain "Approve").
   */
  approveLabel?: string;
  rejectLabel?: string;
  /**
   * Optional callback fired after a successful approve / reject. Parent
   * components that manage their own data (e.g. filter state) can use
   * it to re-load. The router.refresh() fallback always runs.
   */
  onResolved?: (result: { status: 'approved' | 'rejected'; suggestionId: string }) => void;
  /**
   * When true, the Reject button prompts for a reason via `window.prompt`.
   * Default false (reason-less reject is the common path).
   */
  promptForRejectReason?: boolean;
  className?: string;
}

function Avatar({ name }: { name: string | null }) {
  const initial = (name ?? '?').slice(0, 1).toUpperCase();
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-bg text-[11px] font-medium text-fg"
    >
      {initial}
    </span>
  );
}

export function SuggestionApprovalPill({
  suggestionId,
  status,
  requiresQuorum,
  approvers,
  size = 'default',
  approveLabel = 'Approve',
  rejectLabel = 'Reject',
  onResolved,
  promptForRejectReason = false,
  className,
}: SuggestionApprovalPillProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [localStatus, setLocalStatus] = useState<string>(status);
  const [localApprovers, setLocalApprovers] = useState(approvers);

  const isResolved = localStatus !== 'pending';
  const quorumMet = localApprovers.length >= requiresQuorum;

  function onApprove() {
    startTransition(async () => {
      const res = await approveSuggestionViaQueueAction({ suggestionId });
      if (!res.ok) {
        toast({
          title: 'Approve failed',
          description: res.error.message,
          variant: 'destructive',
        });
        return;
      }
      setLocalStatus(res.data.status);
      setLocalApprovers(
        res.data.approvers.map((a) => ({
          memberId: a.memberId,
          memberName: null,
          approvedAt: a.approvedAt,
        })),
      );
      const label = res.data.status === 'approved' ? 'Suggestion approved' : 'Approval recorded';
      toast({ title: label, variant: 'success' });
      onResolved?.({ status: 'approved', suggestionId });
      router.refresh();
    });
  }

  function onReject() {
    let reason: string | undefined;
    if (promptForRejectReason) {
      const entered = window.prompt('Reason for rejecting (optional):');
      if (entered === null) return; // user cancelled
      const trimmed = entered.trim();
      if (trimmed.length > 0) reason = trimmed;
    }
    startTransition(async () => {
      const res = await rejectSuggestionViaQueueAction({
        suggestionId,
        ...(reason ? { reason } : {}),
      });
      if (!res.ok) {
        toast({ title: 'Reject failed', description: res.error.message, variant: 'destructive' });
        return;
      }
      setLocalStatus('rejected');
      toast({ title: 'Suggestion rejected', variant: 'default' });
      onResolved?.({ status: 'rejected', suggestionId });
      router.refresh();
    });
  }

  return (
    <div
      className={cn('flex flex-wrap items-center gap-2', className)}
      aria-live="polite"
      data-testid={`suggestion-pill-${suggestionId}`}
    >
      {isResolved ? (
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-xs font-medium',
            localStatus === 'approved'
              ? 'border-success/60 bg-success/10 text-success'
              : localStatus === 'rejected'
                ? 'border-danger/50 bg-danger/10 text-danger'
                : localStatus === 'executed'
                  ? 'border-accent/60 bg-accent/10 text-accent'
                  : 'border-border bg-bg text-fg-muted',
          )}
        >
          {localStatus}
        </span>
      ) : (
        <>
          <Button size={size} variant="default" onClick={onApprove} disabled={isPending}>
            {isPending ? 'Saving…' : approveLabel}
          </Button>
          <Button size={size} variant="outline" onClick={onReject} disabled={isPending}>
            {rejectLabel}
          </Button>
        </>
      )}

      {requiresQuorum > 1 ? (
        <div className="flex items-center gap-1.5" aria-label="Approval quorum">
          <span className="text-xs text-fg-muted">
            {localApprovers.length} of {requiresQuorum} approvers
            {quorumMet ? ' · quorum met' : ''}
          </span>
          <div className="flex -space-x-1">
            {localApprovers.slice(0, 4).map((a, idx) => (
              <Avatar key={`${a.memberId ?? 'auto'}-${idx}`} name={a.memberName} />
            ))}
          </div>
        </div>
      ) : localApprovers.length > 0 && isResolved && localStatus === 'approved' ? (
        <span className="text-xs text-fg-muted">
          approved by {localApprovers[0]?.memberName ?? 'member'}
        </span>
      ) : null}
    </div>
  );
}
