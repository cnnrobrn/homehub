/**
 * Client islands for the Connections settings page.
 *
 * Only the disconnect action needs interactivity; everything else
 * renders server-side. Disconnect submits a form that calls the
 * `disconnectConnectionAction` server action and refreshes the page
 * on success.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { disconnectConnectionAction } from '@/app/actions/integrations';
import { Button } from '@/components/ui/button';

export function DisconnectButton({ connectionId }: { connectionId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            setError(null);
            const res = await disconnectConnectionAction({ connectionId });
            if (res.ok) {
              router.refresh();
            } else {
              setError(res.error.message);
            }
          });
        }}
      >
        {pending ? 'Disconnecting…' : 'Disconnect'}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
