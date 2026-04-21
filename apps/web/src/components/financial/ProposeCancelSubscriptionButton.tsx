/**
 * `<ProposeCancelSubscriptionButton />` — a small client island.
 *
 * Opens a dialog explaining that the cancel-subscription execution
 * wires up in M9 and lets the member file an intent (`app.suggestion`
 * row, `kind='cancel_subscription'`, `status='pending'`). That row
 * becomes an Approve/Reject card once M9's approval flow lands.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { proposeCancelSubscriptionAction } from '@/app/actions/financial';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';

export interface ProposeCancelSubscriptionButtonProps {
  subscriptionNodeId: string;
  canonicalName: string;
}

export function ProposeCancelSubscriptionButton({
  subscriptionNodeId,
  canonicalName,
}: ProposeCancelSubscriptionButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rationale, setRationale] = useState('');
  const [isPending, startTransition] = useTransition();

  function onSubmit() {
    startTransition(async () => {
      const res = await proposeCancelSubscriptionAction({
        subscriptionNodeId,
        rationale: rationale.trim() || undefined,
      });
      if (res.ok) {
        toast({
          title: 'Proposal filed',
          description: `"${canonicalName}" is queued for review. Approval wiring lands in M9.`,
          variant: 'success',
        });
        setOpen(false);
        setRationale('');
        router.refresh();
      } else {
        toast({
          title: "Couldn't file proposal",
          description: res.error.message,
          variant: 'destructive',
        });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid={`propose-cancel-${subscriptionNodeId}`}>
          Propose cancel
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Propose cancelling {canonicalName}</DialogTitle>
          <DialogDescription>
            This records a pending suggestion so another household member can review it. The actual
            cancellation step (contacting the vendor, rotating payment methods) lands in M9&apos;s
            approval flow.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <label htmlFor="cancel-rationale" className="text-xs text-fg-muted">
            Optional rationale
          </label>
          <Textarea
            id="cancel-rationale"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            rows={3}
            placeholder="Why do you want to cancel this?"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={isPending}>
            {isPending ? 'Filing…' : 'File proposal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
