/**
 * Owner-only dialog for merging two nodes of the same type.
 *
 * Client island. The server action is `mergeNodesAction`. The
 * list of candidate merge targets is passed in as a prop (server
 * pre-resolves "same type, this household" nodes).
 */

'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { mergeNodesAction } from '@/app/actions/memory';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/use-toast';

export interface MergeCandidate {
  id: string;
  canonical_name: string;
}

export interface NodeMergeDialogProps {
  primaryNodeId: string;
  primaryNodeLabel: string;
  candidates: MergeCandidate[];
}

export function NodeMergeDialog({
  primaryNodeId,
  primaryNodeLabel,
  candidates,
}: NodeMergeDialogProps) {
  const [open, setOpen] = useState(false);
  const [mergeNodeId, setMergeNodeId] = useState<string>('');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = () => {
    if (!mergeNodeId) return;
    startTransition(async () => {
      const res = await mergeNodesAction({ primaryNodeId, mergeNodeId });
      if (!res.ok) {
        toast({ title: 'Merge failed', description: res.error.message });
        return;
      }
      toast({
        title: 'Merge complete',
        description: `${primaryNodeLabel} now subsumes the merged node.`,
      });
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={candidates.length === 0}>
          Merge into this node…
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge nodes</DialogTitle>
          <DialogDescription>
            The selected node will be merged into <strong>{primaryNodeLabel}</strong>. Its facts,
            edges, and aliases transfer; the merged node is soft-deleted with an audit entry. This
            cannot be undone from the UI.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Label htmlFor={`merge-${primaryNodeId}`}>Node to merge in</Label>
          <Select value={mergeNodeId} onValueChange={setMergeNodeId}>
            <SelectTrigger id={`merge-${primaryNodeId}`}>
              <SelectValue placeholder="Pick a node…" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.canonical_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={submit} disabled={pending || !mergeNodeId}>
            {pending ? 'Merging…' : 'Merge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
