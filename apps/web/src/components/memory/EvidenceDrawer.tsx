/**
 * Evidence drawer.
 *
 * Client island. Opens from the "Show evidence" button on any
 * fact row. Renders the evidence jsonb array as a readable list
 * (source, timestamp, summary). The drawer announces its open
 * state via `aria-live="polite"` so screen readers hear the shift
 * in focus / context.
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

export interface EvidenceEntry {
  source?: string;
  extractor_version?: string;
  recorded_at?: string;
  summary?: string;
  excerpt?: string;
  row_table?: string;
  row_id?: string;
  [key: string]: unknown;
}

export interface EvidenceDrawerProps {
  factId: string;
  factSubjectLabel: string;
  evidence: EvidenceEntry[];
}

export function EvidenceDrawer({ factSubjectLabel, evidence }: EvidenceDrawerProps) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Show evidence">
          Show evidence
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col gap-4" aria-live="polite">
        <SheetHeader>
          <SheetTitle>Evidence · {factSubjectLabel}</SheetTitle>
        </SheetHeader>
        {evidence.length === 0 ? (
          <p className="text-sm text-fg-muted">No evidence recorded for this fact yet.</p>
        ) : (
          <ul className="flex flex-col gap-3" aria-label="Evidence entries">
            {evidence.map((entry, idx) => (
              <li
                key={`ev-${idx}`}
                className="flex flex-col gap-1 rounded-md border border-border bg-bg/40 p-3"
              >
                <div className="flex items-center justify-between text-xs text-fg-muted">
                  <span className="font-medium">{entry.source ?? 'unknown'}</span>
                  {entry.recorded_at ? (
                    <time dateTime={entry.recorded_at}>
                      {new Date(entry.recorded_at).toLocaleString()}
                    </time>
                  ) : null}
                </div>
                {entry.summary ? <p className="text-sm text-fg">{entry.summary}</p> : null}
                {entry.excerpt ? (
                  <blockquote className="border-l-2 border-border pl-3 text-xs italic text-fg-muted">
                    {entry.excerpt}
                  </blockquote>
                ) : null}
                {entry.row_table ? (
                  <p className="text-xs text-fg-muted">
                    Source row: {entry.row_table} · {entry.row_id ?? '—'}
                  </p>
                ) : null}
                {entry.extractor_version ? (
                  <p className="text-xs text-fg-muted">Extractor: {entry.extractor_version}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
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
