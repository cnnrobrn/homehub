/**
 * `<OutingSuggestionCard />` — renders a pending fun suggestion and, for
 * `outing_idea` kind, offers an Approve button.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { approveOutingIdeaAction } from '@/app/actions/fun';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { type FunSuggestionRow } from '@/lib/fun';

export interface OutingSuggestionCardProps {
  suggestion: FunSuggestionRow;
}

function formatWindow(startRaw: unknown, endRaw: unknown): string {
  const start = typeof startRaw === 'string' ? new Date(startRaw) : null;
  const end = typeof endRaw === 'string' ? new Date(endRaw) : null;
  if (!start || Number.isNaN(start.getTime())) return '';
  const startLabel = start.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  if (!end || Number.isNaN(end.getTime())) return startLabel;
  return `${startLabel} – ${end.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

export function OutingSuggestionCard({ suggestion }: OutingSuggestionCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const canApprove = suggestion.kind === 'outing_idea';

  function onApprove() {
    startTransition(async () => {
      const res = await approveOutingIdeaAction({ suggestionId: suggestion.id });
      if (res.ok) {
        toast({ title: 'Outing approved', variant: 'success' });
        router.refresh();
      } else {
        toast({
          title: "Couldn't approve",
          description: res.error.message,
          variant: 'destructive',
        });
      }
    });
  }

  return (
    <article className="rounded-lg border border-border bg-surface p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">{suggestion.title}</h3>
        <span className="rounded-sm border border-border bg-bg px-2 py-0.5 text-[11px] uppercase tracking-wide text-fg-muted">
          {suggestion.kind.replace(/_/g, ' ')}
        </span>
      </header>
      <p className="mt-1 text-sm text-fg-muted">{suggestion.rationale}</p>
      {canApprove ? (
        <div className="mt-2 text-xs text-fg-muted">
          {formatWindow(suggestion.preview.window_start, suggestion.preview.window_end)}
        </div>
      ) : null}
      {canApprove ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="default" size="sm" onClick={onApprove} disabled={isPending}>
            {isPending ? 'Approving…' : 'Approve outing'}
          </Button>
        </div>
      ) : null}
    </article>
  );
}
