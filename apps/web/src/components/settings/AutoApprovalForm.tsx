/**
 * Auto-approval multi-select form.
 *
 * Client island. Renders a list of check-boxed kinds, saves via
 * `updateAutoApprovalKindsAction` on submit. Destructive kinds
 * (cancel_subscription / propose_transfer / settle_shared_expense)
 * are never offered as options — the state machine refuses to
 * auto-approve them anyway.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { updateAutoApprovalKindsAction } from '@/app/actions/approval';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { AUTO_APPROVE_KIND_OPTIONS } from '@/lib/approval/kinds';

export interface AutoApprovalFormProps {
  initialKinds: readonly string[];
  disabled: boolean;
  disabledReason?: string;
}

export function AutoApprovalForm({
  initialKinds,
  disabled,
  disabledReason,
}: AutoApprovalFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialKinds));

  function toggle(kind: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const res = await updateAutoApprovalKindsAction({ kinds: Array.from(selected) });
      if (!res.ok) {
        toast({
          title: 'Failed to save',
          description: res.error.message,
          variant: 'destructive',
        });
        return;
      }
      toast({
        title: 'Auto-approval updated',
        description: `${res.data.kinds.length} kinds enabled for auto-approval`,
        variant: 'success',
      });
      router.refresh();
    });
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={onSubmit}>
      {disabled ? (
        <p className="rounded-md border border-border bg-bg p-3 text-sm text-fg-muted">
          {disabledReason ?? 'Only owners can change auto-approval preferences.'}
        </p>
      ) : null}
      <fieldset disabled={disabled || isPending} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <legend className="sr-only">Kinds to auto-approve</legend>
        {AUTO_APPROVE_KIND_OPTIONS.map((kind) => (
          <label
            key={kind}
            className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-surface p-3 text-sm hover:bg-bg/30"
          >
            <input
              type="checkbox"
              name="kind"
              value={kind}
              checked={selected.has(kind)}
              onChange={() => toggle(kind)}
              className="mt-0.5"
            />
            <span className="flex-1">
              <span className="font-medium text-fg">{kind.replace(/_/g, ' ')}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-fg-muted">
        Destructive kinds (cancel subscription, transfer funds, settle shared expense) are never
        auto-approved and are not shown in this list.
      </p>
      {!disabled ? (
        <div>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Saving…' : 'Save auto-approval settings'}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
