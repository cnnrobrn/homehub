/**
 * `<SuggestionEvidenceDrawer />` — "Why this suggestion?" drawer.
 *
 * Mirrors the shape of `components/memory/EvidenceDrawer.tsx`. Open
 * from any suggestion row. Renders:
 *
 *   - The evidence chain (if the generator stashed evidence entries on
 *     `preview.evidence`).
 *   - The originating alert's context (when `preview.source_alert_id`
 *     resolved during detail load).
 *   - The model prompt + version metadata (when present on
 *     `preview.model_prompt_id` / `preview.model_version`).
 *
 * Focus-trapping is delegated to the shared Sheet primitive which wraps
 * Radix's Dialog under the hood.
 */

'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

export interface SuggestionEvidenceDrawerProps {
  suggestionId: string;
  suggestionTitle: string;
  /**
   * Optional originating alert context. When present, rendered as a
   * top-of-drawer summary. Shape is whatever the alert generator
   * persisted to `alert.context`.
   */
  alertContext: Record<string, unknown> | null;
  /**
   * Evidence entries the generator stashed on `preview.evidence`. Same
   * rough shape as `EvidenceEntry` in the memory module.
   */
  evidence: readonly Record<string, unknown>[];
  /** Optional model prompt id / version to surface. */
  modelPromptId?: string | null;
  modelVersion?: string | null;
  /** Optional source rows (e.g. `source_email_id`). */
  sourceRows?: readonly { table: string; id: string }[];
  /** Button label override. */
  label?: string;
}

export function SuggestionEvidenceDrawer({
  suggestionTitle,
  alertContext,
  evidence,
  modelPromptId,
  modelVersion,
  sourceRows,
  label = 'Why this suggestion?',
}: SuggestionEvidenceDrawerProps) {
  const [open, setOpen] = useState(false);
  const empty =
    !alertContext &&
    evidence.length === 0 &&
    !modelPromptId &&
    !modelVersion &&
    (!sourceRows || sourceRows.length === 0);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm">
          {label}
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col gap-4" aria-live="polite">
        <SheetHeader>
          <SheetTitle>Evidence · {suggestionTitle}</SheetTitle>
        </SheetHeader>

        {empty ? (
          <p className="text-sm text-fg-muted">
            No evidence was recorded for this suggestion. This can happen when the suggestion was
            drafted without model assistance (for example, a member-proposed transfer).
          </p>
        ) : null}

        {alertContext ? (
          <section
            className="rounded-md border border-border bg-bg/40 p-3"
            aria-label="Origin alert"
          >
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Origin alert
            </h3>
            {typeof alertContext.title === 'string' ? (
              <p className="mt-1 text-sm font-medium text-fg">{alertContext.title}</p>
            ) : null}
            {typeof alertContext.body === 'string' ? (
              <p className="mt-1 text-sm text-fg-muted">{alertContext.body}</p>
            ) : null}
            {alertContext.context && typeof alertContext.context === 'object' ? (
              <pre className="mt-2 max-h-40 overflow-auto rounded border border-border bg-surface p-2 text-[11px] text-fg-muted">
                {JSON.stringify(alertContext.context, null, 2)}
              </pre>
            ) : null}
          </section>
        ) : null}

        {evidence.length > 0 ? (
          <section aria-label="Evidence entries" className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Evidence
            </h3>
            <ul className="flex flex-col gap-2">
              {evidence.map((entry, idx) => {
                const source = typeof entry.source === 'string' ? entry.source : 'unknown';
                const recordedAt =
                  typeof entry.recorded_at === 'string' ? (entry.recorded_at as string) : null;
                const summary =
                  typeof entry.summary === 'string' ? (entry.summary as string) : null;
                const excerpt =
                  typeof entry.excerpt === 'string' ? (entry.excerpt as string) : null;
                const rowTable =
                  typeof entry.row_table === 'string' ? (entry.row_table as string) : null;
                const rowId = typeof entry.row_id === 'string' ? (entry.row_id as string) : null;
                return (
                  <li
                    key={`ev-${idx}`}
                    className="flex flex-col gap-1 rounded-md border border-border bg-bg/30 p-3"
                  >
                    <div className="flex items-center justify-between text-xs text-fg-muted">
                      <span className="font-medium">{source}</span>
                      {recordedAt ? (
                        <time dateTime={recordedAt}>{new Date(recordedAt).toLocaleString()}</time>
                      ) : null}
                    </div>
                    {summary ? <p className="text-sm text-fg">{summary}</p> : null}
                    {excerpt ? (
                      <blockquote className="border-l-2 border-border pl-3 text-xs italic text-fg-muted">
                        {excerpt}
                      </blockquote>
                    ) : null}
                    {rowTable ? (
                      <p className="text-xs text-fg-muted">
                        Source row: {rowTable} · {rowId ?? '—'}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {sourceRows && sourceRows.length > 0 ? (
          <section aria-label="Source rows" className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Source rows
            </h3>
            <ul className="text-xs text-fg-muted">
              {sourceRows.map((row, idx) => (
                <li key={`src-${idx}`}>
                  {row.table} · {row.id}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {modelPromptId || modelVersion ? (
          <section aria-label="Model" className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Model</h3>
            {modelPromptId ? (
              <p className="text-xs text-fg-muted">Prompt: {modelPromptId}</p>
            ) : null}
            {modelVersion ? <p className="text-xs text-fg-muted">Version: {modelVersion}</p> : null}
          </section>
        ) : null}

        <div className="mt-auto flex justify-end">
          <SheetClose asChild>
            <Button variant="outline" size="sm">
              Close
            </Button>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}
