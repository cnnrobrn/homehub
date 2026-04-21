/**
 * `<FinancialSummaryCard />` — one card per `app.summary` row.
 *
 * Server Component. Renders the deterministic markdown body in a
 * preformatted block (the shared markdown renderer lands later — same
 * pattern as `<InsightCard />`). A small metrics strip pulls out the
 * period + model metadata for quick scanning.
 *
 * Headings in the body are expected to start at `h2+` so the page-level
 * `h1` remains the only top-level heading.
 */

import type { FinancialSummaryRow } from '@/lib/financial';

export interface FinancialSummaryCardProps {
  summary: FinancialSummaryRow;
}

function formatRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${startIso} — ${endIso}`;
  }
  return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

export function FinancialSummaryCard({ summary }: FinancialSummaryCardProps) {
  return (
    <article
      aria-label={`${summary.period} summary covering ${formatRange(summary.coveredStart, summary.coveredEnd)}`}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight text-fg">
          {summary.period === 'week'
            ? 'Weekly summary'
            : summary.period === 'month'
              ? 'Monthly summary'
              : `${summary.period} summary`}
        </h2>
        <span className="text-xs text-fg-muted">
          {formatRange(summary.coveredStart, summary.coveredEnd)}
        </span>
      </header>
      <pre className="whitespace-pre-wrap break-words text-sm text-fg-muted">{summary.bodyMd}</pre>
      <footer className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-fg-muted">
        <span>Model {summary.model}</span>
        <span>·</span>
        <span>Generated {new Date(summary.generatedAt).toLocaleString()}</span>
      </footer>
    </article>
  );
}
