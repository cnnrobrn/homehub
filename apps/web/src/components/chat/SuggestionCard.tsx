'use client';

/**
 * Suggestion card rendered inline when a draft-write tool returns a
 * `pending_approval` envelope. Approve/Reject controls are live but
 * the server-side approval state machine lands in M9; for now they
 * show a toast when clicked.
 */

import * as React from 'react';

import { Button } from '@/components/ui/button';
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
      title: choice === 'approved' ? 'Queued for approval' : 'Suggestion dismissed',
      description:
        choice === 'approved'
          ? 'Approval pipeline ships in M9. Your choice is recorded for now.'
          : "We'll remember you said no.",
    });
  }

  return (
    <div
      className="my-2 rounded-md border border-amber-600/50 bg-amber-50/10 p-3"
      role="region"
      aria-label={`Suggestion: ${tool}`}
      data-call-id={callId}
    >
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-amber-700 dark:text-amber-300">
        <span className="font-mono">{tool}</span>
        <span className="text-fg-muted">pending approval</span>
      </div>
      <p className="mb-3 text-sm">{summary}</p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={decided !== null}
          onClick={() => decide('approved')}
        >
          {decided === 'approved' ? 'Approved' : 'Approve'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={decided !== null}
          onClick={() => decide('rejected')}
        >
          {decided === 'rejected' ? 'Rejected' : 'Reject'}
        </Button>
      </div>
    </div>
  );
}
