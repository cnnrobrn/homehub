/**
 * Pin toggle for a node. Client island because it mutates via a
 * server action and needs to show the pending state.
 */

'use client';

import { Pin, PinOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { pinNodeAction, unpinNodeAction } from '@/app/actions/memory';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';

export interface PinButtonProps {
  nodeId: string;
  initialPinned: boolean;
}

export function PinButton({ nodeId, initialPinned }: PinButtonProps) {
  const [pinned, setPinned] = useState(initialPinned);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const onClick = () => {
    startTransition(async () => {
      const next = !pinned;
      const res = next ? await pinNodeAction({ nodeId }) : await unpinNodeAction({ nodeId });
      if (!res.ok) {
        toast({ title: 'Could not update pin', description: res.error.message });
        return;
      }
      setPinned(next);
      router.refresh();
    });
  };

  return (
    <Button
      variant={pinned ? 'secondary' : 'outline'}
      size="sm"
      onClick={onClick}
      disabled={pending}
      aria-pressed={pinned}
      aria-label={pinned ? 'Unpin node' : 'Pin node'}
      title={pinned ? 'Unpin this node' : 'Pin this node'}
    >
      {pinned ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4" />}
      <span className="ml-1.5">{pinned ? 'Pinned' : 'Pin'}</span>
    </Button>
  );
}
