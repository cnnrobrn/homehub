/**
 * `<SuggestionListRow />` — single row on the unified `/suggestions`
 * page.
 *
 * Client Component because the expand/collapse state and the
 * SuggestionApprovalPill live here.
 */

'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { SuggestionApprovalPill } from './SuggestionApprovalPill';
import { SuggestionEvidenceDrawer } from './SuggestionEvidenceDrawer';

import type { SuggestionRowView } from '@/lib/suggestions';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export interface SuggestionListRowProps {
  suggestion: SuggestionRowView;
  /**
   * Optional deep-link override. When supplied, the "View source" link
   * on the row points at this href; when omitted, the link is hidden.
   */
  sourceHref?: string | null;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Best-effort source-href resolver. Segment-specific pages know how to
 * deep-link to the source row for each `kind`; the resolver falls back
 * to the segment's dashboard for any kind it doesn't recognize.
 */
export function resolveSourceHref(suggestion: SuggestionRowView): string | null {
  const preview = suggestion.preview;
  switch (suggestion.kind) {
    case 'cancel_subscription': {
      const nodeId = preview.subscription_node_id;
      if (typeof nodeId === 'string') {
        return `/memory/subscription/${nodeId}`;
      }
      return '/financial';
    }
    case 'reach_out':
    case 'gift_idea':
    case 'host_back': {
      const nodeId = preview.person_node_id;
      if (typeof nodeId === 'string') return `/memory/person/${nodeId}`;
      return '/social';
    }
    case 'outing_idea':
    case 'trip_prep':
    case 'propose_add_to_calendar':
    case 'add_to_calendar':
      return '/fun';
    case 'propose_grocery_order':
    case 'draft_meal_plan':
    case 'grocery_order':
    case 'meal_swap':
    case 'new_dish':
    case 'propose_book_reservation':
      return '/food';
    case 'propose_transfer':
    case 'settle_shared_expense':
      return '/financial';
    case 'draft_message':
      return '/social';
    default:
      return null;
  }
}

export function SuggestionListRow({ suggestion, sourceHref }: SuggestionListRowProps) {
  const [expanded, setExpanded] = useState(false);
  const href = sourceHref ?? resolveSourceHref(suggestion);

  const previewKeys = Object.keys(suggestion.preview).filter((k) => !k.startsWith('__'));
  const hasPreview = previewKeys.length > 0;

  const rawEvidence = suggestion.preview.evidence;
  const evidence =
    Array.isArray(rawEvidence) && rawEvidence.every((e) => typeof e === 'object' && e !== null)
      ? (rawEvidence as Array<Record<string, unknown>>)
      : [];
  const modelPromptId =
    typeof suggestion.preview.model_prompt_id === 'string'
      ? suggestion.preview.model_prompt_id
      : null;
  const modelVersion =
    typeof suggestion.preview.model_version === 'string' ? suggestion.preview.model_version : null;

  return (
    <li
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-sm',
        suggestion.status !== 'pending' && 'opacity-80',
      )}
      data-testid={`suggestion-row-${suggestion.id}`}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="truncate font-medium text-fg">{suggestion.title}</h3>
            <span className="rounded-sm border border-border bg-bg px-2 py-0.5 text-[11px] uppercase tracking-wide text-fg-muted">
              {suggestion.segment}
            </span>
            <span className="rounded-sm border border-border bg-bg px-2 py-0.5 text-[11px] uppercase tracking-wide text-fg-muted">
              {suggestion.kind.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="text-xs text-fg-muted">
            {formatWhen(suggestion.createdAt)}
            {suggestion.resolvedAt ? <> · resolved {formatWhen(suggestion.resolvedAt)}</> : null}
            {suggestion.resolvedByMemberName ? <> · by {suggestion.resolvedByMemberName}</> : null}
          </p>
        </div>
      </header>

      <p className="text-fg-muted">{suggestion.rationale}</p>

      <div className="flex flex-wrap items-center gap-2">
        <SuggestionApprovalPill
          suggestionId={suggestion.id}
          status={suggestion.status}
          requiresQuorum={suggestion.requiresQuorum}
          approvers={suggestion.approvers}
          size="sm"
        />
        <SuggestionEvidenceDrawer
          suggestionId={suggestion.id}
          suggestionTitle={suggestion.title}
          alertContext={null}
          evidence={evidence}
          modelPromptId={modelPromptId}
          modelVersion={modelVersion}
        />
        {hasPreview ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={`sug-${suggestion.id}-preview`}
          >
            {expanded ? (
              <>
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
                Hide preview
              </>
            ) : (
              <>
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
                Show preview
              </>
            )}
          </Button>
        ) : null}
        {href ? (
          <Link
            href={href as never}
            className="text-xs text-accent underline-offset-2 hover:underline"
          >
            View source
          </Link>
        ) : null}
      </div>

      {expanded && hasPreview ? (
        <pre
          id={`sug-${suggestion.id}-preview`}
          className="max-h-80 overflow-auto rounded-md border border-border bg-bg/40 p-3 text-xs text-fg"
        >
          {JSON.stringify(
            Object.fromEntries(previewKeys.map((k) => [k, suggestion.preview[k]])),
            null,
            2,
          )}
        </pre>
      ) : null}
    </li>
  );
}
