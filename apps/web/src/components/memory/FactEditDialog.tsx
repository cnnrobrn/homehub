/**
 * Member-facing fact editor.
 *
 * Explicitly flags to the user that an edit writes a member-sourced
 * candidate that the reconciler processes (never a direct update).
 * Keeps edits honest — the member sees where their correction goes.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { editFactAction } from '@/app/actions/memory';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';

export interface FactEditDialogProps {
  factId: string;
  predicate: string;
  currentValue: unknown;
}

export function FactEditDialog({ factId, predicate, currentValue }: FactEditDialogProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(
    typeof currentValue === 'string' ? currentValue : JSON.stringify(currentValue ?? ''),
  );
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = () => {
    startTransition(async () => {
      // Best-effort: numbers as numbers, booleans as booleans, else string.
      let parsed: unknown = value;
      const trimmed = value.trim();
      if (trimmed.length === 0) parsed = null;
      else if (!Number.isNaN(Number(trimmed)) && /^-?\d/.test(trimmed)) parsed = Number(trimmed);
      else if (trimmed === 'true') parsed = true;
      else if (trimmed === 'false') parsed = false;

      const res = await editFactAction({ factId, newObjectValue: parsed });
      if (!res.ok) {
        toast({ title: 'Edit failed', description: res.error.message });
        return;
      }
      toast({
        title: 'Correction submitted',
        description: 'Your edit will be applied after the reconciler processes it.',
      });
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit fact</DialogTitle>
          <DialogDescription>
            This creates a member-sourced correction for the reconciler to process. The canonical
            fact will be superseded on the next run.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>Predicate</Label>
            <div className="rounded-md border border-border bg-surface/60 px-3 py-1.5 text-sm text-fg-muted">
              {predicate}
            </div>
          </div>
          <Label htmlFor={`fact-value-${factId}`}>New value</Label>
          <Input
            id={`fact-value-${factId}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Submitting…' : 'Submit correction'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
