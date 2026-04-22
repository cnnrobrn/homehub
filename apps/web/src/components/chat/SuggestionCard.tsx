'use client';

/**
 * Suggestion card rendered inline when a draft-write tool returns a
 * `pending_approval` envelope.
 *
 * Visual shape follows the V2 Indie `InlineSuggestion` — a soft card
 * with a teal accent stripe on the left, the drafted action in prose,
 * and two quiet buttons (primary + quiet). Approve/Reject controls
 * are live but the server-side approval state machine lands in M9; for
 * now they surface a toast.
 */

import * as React from 'react';

import { WarmButton } from '@/components/design-system';
import { toast } from '@/components/ui/use-toast';

interface SuggestionCardProps {
  callId: string;
  tool: string;
  summary: string;
  preview: unknown;
}

export function SuggestionCard({ callId, tool, summary }: SuggestionCardProps) {
  const [decided, setDecided] = React.useState<null | 'approved' | 'rejected'>(null);

  function decide(choice: 'approved' | 'rejected') {
    setDecided(choice);
    toast({
      title: choice === 'approved' ? 'queued for approval' : 'suggestion dismissed',
      description:
        choice === 'approved'
          ? 'approval pipeline ships in m9. your choice is recorded for now.'
          : "we'll remember you said no.",
    });
  }

  return (
    <div
      className="my-3 rounded-[4px] border border-border border-l-[3px] border-l-accent bg-surface px-4 py-3.5"
      role="region"
      aria-label={`Suggestion: ${tool}`}
      data-call-id={callId}
    >
      <div className="mb-2 flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
        <span>{tool.replace(/_/g, ' ')}</span>
        <span>·</span>
        <span>needs your ok</span>
      </div>
      <p className="mb-3 text-[13.5px] leading-[1.55] text-fg">{summary}</p>
      <div className="flex items-center gap-1.5">
        <WarmButton
          type="button"
          size="sm"
          variant="primary"
          disabled={decided !== null}
          onClick={() => decide('approved')}
        >
          {decided === 'approved' ? 'approved' : 'yes, do it'}
        </WarmButton>
        <WarmButton
          type="button"
          size="sm"
          variant="quiet"
          disabled={decided !== null}
          onClick={() => decide('rejected')}
        >
          {decided === 'rejected' ? 'dismissed' : 'not now'}
        </WarmButton>
      </div>
    </div>
  );
}
