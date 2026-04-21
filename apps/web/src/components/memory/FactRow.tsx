/**
 * Single fact row with per-fact affordances.
 *
 * Client island because every action is a mutation. Renders the
 * fact's predicate + object, an optional conflict badge, and a
 * dropdown menu (Confirm / Edit / Dispute / Delete) that dispatches
 * to the matching server action.
 *
 * The evidence drawer and edit dialog are sibling components so
 * the action dropdown stays keyboard-friendly (no nested
 * focus-trapping).
 */

'use client';

import { MoreHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { ConflictBadge } from './ConflictBadge';
import { EvidenceDrawer, type EvidenceEntry } from './EvidenceDrawer';
import { FactEditDialog } from './FactEditDialog';

import { confirmFactAction, disputeFactAction, deleteFactAction } from '@/app/actions/memory';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/use-toast';
import { cn } from '@/lib/cn';

export type { EvidenceEntry };

export interface FactRowData {
  id: string;
  predicate: string;
  object_value: unknown;
  object_node_id: string | null;
  object_label?: string | null;
  confidence: number;
  valid_from: string;
  valid_to: string | null;
  source: string;
  conflict_status: string;
  reinforcement_count: number;
  evidence: EvidenceEntry[];
  superseded_at: string | null;
  superseded_by: string | null;
}

export interface FactRowProps {
  fact: FactRowData;
  subjectLabel: string;
}

function formatObject(fact: FactRowData): string {
  if (fact.object_label) return fact.object_label;
  if (fact.object_node_id) return `→ ${fact.object_node_id.slice(0, 8)}`;
  const val = fact.object_value;
  if (val === null || val === undefined) return '—';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  try {
    return JSON.stringify(val);
  } catch {
    return '—';
  }
}

export function FactRow({ fact, subjectLabel }: FactRowProps) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const onConfirm = () => {
    startTransition(async () => {
      const res = await confirmFactAction({ factId: fact.id });
      if (!res.ok) {
        toast({ title: 'Confirm failed', description: res.error.message });
        return;
      }
      toast({
        title: 'Confirmed',
        description: 'This fact will be reinforced on the next reconciler run.',
      });
      router.refresh();
    });
  };

  const onDispute = () => {
    const reason = window.prompt('Why is this fact incorrect?');
    if (!reason || reason.trim().length === 0) return;
    startTransition(async () => {
      const res = await disputeFactAction({ factId: fact.id, reason: reason.trim() });
      if (!res.ok) {
        toast({ title: 'Dispute failed', description: res.error.message });
        return;
      }
      toast({ title: 'Dispute recorded', description: 'The fact is flagged as unresolved.' });
      router.refresh();
    });
  };

  const onDelete = () => {
    const reason = window.prompt('Why should this fact be forgotten?');
    if (!reason || reason.trim().length === 0) return;
    startTransition(async () => {
      const res = await deleteFactAction({ factId: fact.id, reason: reason.trim() });
      if (!res.ok) {
        toast({ title: 'Delete failed', description: res.error.message });
        return;
      }
      toast({
        title: 'Deletion requested',
        description: 'The reconciler will process this on its next run.',
      });
      router.refresh();
    });
  };

  const hasConflict = fact.conflict_status !== 'none';
  const [showHistory, setShowHistory] = useState(false);

  return (
    <li
      className={cn(
        'flex flex-col gap-2 border-b border-border px-3 py-2 last:border-b-0',
        hasConflict && 'border-l-2 border-l-warn bg-warn/5',
      )}
      data-testid={`fact-row-${fact.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-fg">{fact.predicate}</span>
            <span className="text-fg-muted">=</span>
            <span className="truncate">{formatObject(fact)}</span>
            <ConflictBadge status={fact.conflict_status} />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
            <span>{fact.source}</span>
            <span>confidence {Math.round(fact.confidence * 100)}%</span>
            <span>reinforced x{fact.reinforcement_count}</span>
            <span>since {new Date(fact.valid_from).toLocaleDateString()}</span>
            {fact.valid_to ? (
              <span>until {new Date(fact.valid_to).toLocaleDateString()}</span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <EvidenceDrawer
            factId={fact.id}
            factSubjectLabel={`${subjectLabel} · ${fact.predicate}`}
            evidence={fact.evidence}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Actions for fact ${fact.predicate}`}
                disabled={pending}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onConfirm}>Confirm</DropdownMenuItem>
              <FactEditDialog
                factId={fact.id}
                predicate={fact.predicate}
                currentValue={fact.object_value}
              />
              <DropdownMenuItem onSelect={onDispute}>Dispute…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onDelete} className="text-danger">
                Forget…
              </DropdownMenuItem>
              {fact.superseded_at || hasConflict ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      setShowHistory((v) => !v);
                    }}
                  >
                    {showHistory ? 'Hide supersession history' : 'Show supersession history'}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {showHistory && (fact.superseded_at || hasConflict) ? (
        <div className="rounded-md border border-border bg-surface/60 p-2 text-xs text-fg-muted">
          <p className="font-medium text-fg">Supersession</p>
          {fact.superseded_at ? (
            <p>Superseded at {new Date(fact.superseded_at).toLocaleString()}</p>
          ) : (
            <p>Not superseded; conflict status is {fact.conflict_status}.</p>
          )}
          {fact.superseded_by ? <p>Successor fact id: {fact.superseded_by.slice(0, 8)}…</p> : null}
        </div>
      ) : null}
    </li>
  );
}
