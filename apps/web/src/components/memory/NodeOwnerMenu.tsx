/**
 * Owner-only dropdown for the node detail page.
 *
 * Surfaces Merge and Delete. Both actions are visible only to
 * members whose role resolves to `'owner'` via
 * `getHouseholdContext()`. The RLS + action-layer role check is the
 * backstop; this UI-level guard keeps the affordance from showing
 * up where it isn't usable.
 */

'use client';

import { MoreHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { NodeMergeDialog, type MergeCandidate } from './NodeMergeDialog';

import { deleteNodeAction } from '@/app/actions/memory';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/use-toast';

export interface NodeOwnerMenuProps {
  nodeId: string;
  nodeLabel: string;
  mergeCandidates: MergeCandidate[];
}

export function NodeOwnerMenu({ nodeId, nodeLabel, mergeCandidates }: NodeOwnerMenuProps) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const onDelete = () => {
    const reason = window.prompt(`Reason for deleting "${nodeLabel}"?`);
    if (!reason || reason.trim().length === 0) return;
    startTransition(async () => {
      const res = await deleteNodeAction({ nodeId, reason: reason.trim() });
      if (!res.ok) {
        toast({ title: 'Delete failed', description: res.error.message });
        return;
      }
      toast({ title: 'Node deleted', description: `${nodeLabel} was soft-deleted.` });
      router.push('/memory');
    });
  };

  return (
    <div className="flex items-center gap-2">
      <NodeMergeDialog
        primaryNodeId={nodeId}
        primaryNodeLabel={nodeLabel}
        candidates={mergeCandidates}
      />
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="More actions" disabled={pending}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onDelete} className="text-danger">
            Delete node…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
