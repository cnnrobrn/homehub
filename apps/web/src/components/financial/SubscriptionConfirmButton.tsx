/**
 * `<SubscriptionConfirmButton />` — one-click "this really is a
 * subscription" affirmation.
 *
 * Flips the node's `needs_review` flag via the existing
 * `toggleNeedsReviewAction`. The detector sets `needs_review=true`
 * whenever match confidence is borderline; an explicit member
 * confirmation clears the flag.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { toggleNeedsReviewAction } from '@/app/actions/memory';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';

export interface SubscriptionConfirmButtonProps {
  subscriptionNodeId: string;
}

export function SubscriptionConfirmButton({ subscriptionNodeId }: SubscriptionConfirmButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const res = await toggleNeedsReviewAction({ nodeId: subscriptionNodeId });
      if (res.ok) {
        toast({ title: 'Confirmed', description: 'Subscription confirmed.', variant: 'success' });
        router.refresh();
      } else {
        toast({
          title: "Couldn't confirm",
          description: res.error.message,
          variant: 'destructive',
        });
      }
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={isPending}
      aria-label="Confirm this is a subscription"
      data-testid={`confirm-subscription-${subscriptionNodeId}`}
    >
      {isPending ? 'Confirming…' : 'Confirm'}
    </Button>
  );
}
