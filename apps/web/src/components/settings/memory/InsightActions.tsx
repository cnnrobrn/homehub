/**
 * Client island: "Looks right" / "Not useful" buttons on an insight.
 *
 * Writes either `mem.insight.confirmed` or `mem.insight.dismissed`
 * audit events via the matching server actions and refreshes the
 * insight feed on success.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { confirmInsightAction, dismissInsightAction } from '@/app/actions/memory';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';

export interface InsightActionsProps {
  insightId: string;
  alreadyConfirmed: boolean;
  alreadyDismissed: boolean;
}

export function InsightActions({
  insightId,
  alreadyConfirmed,
  alreadyDismissed,
}: InsightActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (
    fn: typeof confirmInsightAction | typeof dismissInsightAction,
    verb: 'Confirmed' | 'Dismissed',
  ) => {
    startTransition(async () => {
      const res = await fn({ insightId });
      if (!res.ok) {
        toast({
          variant: 'destructive',
          title: `Could not ${verb.toLowerCase()} insight`,
          description: res.error.message,
        });
        return;
      }
      toast({ variant: 'success', title: `${verb}` });
      router.refresh();
    });
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={pending || alreadyConfirmed}
        onClick={() => run(confirmInsightAction, 'Confirmed')}
      >
        {alreadyConfirmed ? 'Looks right ✓' : 'Looks right'}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending || alreadyDismissed}
        onClick={() => run(dismissInsightAction, 'Dismissed')}
      >
        {alreadyDismissed ? 'Dismissed ✓' : 'Not useful'}
      </Button>
    </>
  );
}
