/**
 * Toggle for `mem.node.needs_review`.
 *
 * Sits next to the node header. Server action updates the flag
 * under member-RLS (trigger guard allows this specific column).
 */

'use client';

import { CheckCircle2, AlertCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { toggleNeedsReviewAction } from '@/app/actions/memory';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';

export interface NeedsReviewToggleProps {
  nodeId: string;
  initialValue: boolean;
}

export function NeedsReviewToggle({ nodeId, initialValue }: NeedsReviewToggleProps) {
  const [value, setValue] = useState(initialValue);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const onClick = () => {
    startTransition(async () => {
      const res = await toggleNeedsReviewAction({ nodeId });
      if (!res.ok) {
        toast({ title: 'Update failed', description: res.error.message });
        return;
      }
      setValue(res.data.needs_review);
      router.refresh();
    });
  };

  return (
    <Button
      variant={value ? 'secondary' : 'outline'}
      size="sm"
      onClick={onClick}
      disabled={pending}
      aria-pressed={value}
      aria-label={value ? 'Clear needs-review flag' : 'Flag node for review'}
      title={value ? 'This node is flagged for review' : 'Flag this node for review'}
    >
      {value ? <AlertCircle className="h-4 w-4 text-warn" /> : <CheckCircle2 className="h-4 w-4" />}
      <span className="ml-1.5">{value ? 'Needs review' : 'Mark needs review'}</span>
    </Button>
  );
}
