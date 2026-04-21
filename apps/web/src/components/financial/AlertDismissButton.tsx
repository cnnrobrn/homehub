/**
 * `<AlertDismissButton />` — dismiss a single financial alert.
 *
 * Thin client island that wraps `dismissAlertAction` and refreshes the
 * current route on success. Optimistic-UI is intentionally off — the
 * server action is fast and the alert disappearing only after the
 * refresh keeps the UI consistent with the DB state.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { dismissAlertAction } from '@/app/actions/financial';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';

export interface AlertDismissButtonProps {
  alertId: string;
}

export function AlertDismissButton({ alertId }: AlertDismissButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const res = await dismissAlertAction({ alertId });
      if (res.ok) {
        toast({ title: 'Alert dismissed', variant: 'success' });
        router.refresh();
      } else {
        toast({
          title: "Couldn't dismiss",
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
      data-testid={`dismiss-alert-${alertId}`}
    >
      {isPending ? 'Dismissing…' : 'Dismiss'}
    </Button>
  );
}
