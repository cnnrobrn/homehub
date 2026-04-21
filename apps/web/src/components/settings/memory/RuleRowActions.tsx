/**
 * Client island: Edit / Archive / Delete dropdown for a household rule.
 *
 * Only renders for rules the caller authored (the parent table guards
 * this). The three confirmation surfaces:
 *   - Edit: opens a Dialog with description + predicate_dsl textarea.
 *   - Archive: flips `active` without a dialog (single click is enough;
 *     easy to un-archive via Edit).
 *   - Delete: opens a Dialog; member must click the destructive button
 *     to confirm.
 */

'use client';

import { MoreHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { deleteRuleAction, updateRuleAction } from '@/app/actions/memory';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';

export interface RuleRowActionsProps {
  ruleId: string;
  description: string;
  active: boolean;
}

export function RuleRowActions({ ruleId, description, active }: RuleRowActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [draftDescription, setDraftDescription] = useState(description);

  const runUpdate = (patch: Parameters<typeof updateRuleAction>[0]) => {
    startTransition(async () => {
      const res = await updateRuleAction(patch);
      if (!res.ok) {
        toast({
          variant: 'destructive',
          title: 'Could not update rule',
          description: res.error.message,
        });
        return;
      }
      toast({ variant: 'success', title: 'Rule updated' });
      setEditOpen(false);
      router.refresh();
    });
  };

  const runDelete = () => {
    startTransition(async () => {
      const res = await deleteRuleAction({ ruleId });
      if (!res.ok) {
        toast({
          variant: 'destructive',
          title: 'Could not delete rule',
          description: res.error.message,
        });
        return;
      }
      toast({ variant: 'success', title: 'Rule deleted' });
      setDeleteOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Actions for rule ${description.slice(0, 40)}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setEditOpen(true);
            }}
          >
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              runUpdate({ ruleId, active: !active });
            }}
          >
            {active ? 'Archive' : 'Restore'}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-danger focus:text-danger"
            onSelect={(e) => {
              e.preventDefault();
              setDeleteOpen(true);
            }}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit rule</DialogTitle>
            <DialogDescription>
              Edit the human-readable description. Structural changes to the predicate DSL ride the
              same server action.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`edit-rule-${ruleId}`}>Description</Label>
            <Textarea
              id={`edit-rule-${ruleId}`}
              value={draftDescription}
              onChange={(e) => setDraftDescription(e.currentTarget.value)}
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} type="button">
              Cancel
            </Button>
            <Button
              disabled={pending || draftDescription.trim().length === 0}
              onClick={() => runUpdate({ ruleId, description: draftDescription.trim() })}
            >
              {pending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this rule?</DialogTitle>
            <DialogDescription>
              This immediately removes the rule. The assistant stops honoring it on the next turn.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} type="button">
              Cancel
            </Button>
            <Button variant="destructive" disabled={pending} onClick={runDelete}>
              {pending ? 'Deleting…' : 'Delete rule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
