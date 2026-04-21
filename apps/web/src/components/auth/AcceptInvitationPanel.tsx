/**
 * Client-side accept panel for the `/invite/[token]` flow.
 *
 * Keeps the page server-rendered by default; only the interactive accept
 * button runs on the client. On success, navigates to the dashboard.
 */

'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';

import { acceptInvitationAction } from '@/app/actions/household';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';

export function AcceptInvitationPanel({
  token,
  householdName,
}: {
  token: string;
  householdName: string;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();

  function onAccept() {
    start(async () => {
      const res = await acceptInvitationAction({ token });
      if (!res.ok) {
        toast({
          variant: 'destructive',
          title: 'Could not accept',
          description: res.error.message,
        });
        return;
      }
      toast({
        variant: 'success',
        title: `Welcome to ${householdName}`,
      });
      router.replace('/');
      router.refresh();
    });
  }

  return (
    <Button onClick={onAccept} disabled={pending} className="w-full">
      {pending ? 'Joining…' : `Accept invitation to ${householdName}`}
    </Button>
  );
}
