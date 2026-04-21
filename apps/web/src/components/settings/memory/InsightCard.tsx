/**
 * One card per `mem.insight` row.
 *
 * Renders the cleaned `body_md` (HTML-comment citation footnote
 * stripped) as a preformatted block. Markdown-to-HTML rendering is
 * deferred to a shared renderer landing in a later dispatch; for now
 * we preserve the markdown source so the member still sees the
 * reflector's output as written.
 *
 * Citations (when present) render behind a "Show citations"
 * disclosure. The Confirm / Dismiss buttons are a small client island
 * (see `<InsightActions>`) so the rest of the card stays server-rendered.
 */

import { InsightActions } from './InsightActions';

import type { InsightSummary } from '@/app/actions/memory';

import { stripCitationFootnote } from '@/lib/memory/insights';

export interface InsightCardProps {
  insight: InsightSummary;
  currentMemberId: string;
}

function formatWeekStart(weekStart: string): string {
  // `weekStart` is a date (YYYY-MM-DD). Convert to local midnight so
  // the formatter doesn't jump a day on negative UTC offsets.
  const [y, m, d] = weekStart.split('-').map((p) => Number.parseInt(p, 10));
  if (!y || !m || !d) return weekStart;
  const dt = new Date(y, m - 1, d);
  return `Week of ${dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

export function InsightCard({ insight, currentMemberId }: InsightCardProps) {
  const { cleanBody, citations } = stripCitationFootnote(insight.bodyMd);
  const alreadyConfirmed = insight.confirmedByMemberIds.includes(currentMemberId);
  const alreadyDismissed = insight.dismissedByMemberIds.includes(currentMemberId);
  const confirmedOthers = insight.confirmedByMemberIds.filter((id) => id !== currentMemberId);

  return (
    <article className="rounded-md border border-border bg-bg p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">{formatWeekStart(insight.weekStart)}</h3>
        {confirmedOthers.length > 0 ? (
          <span className="text-xs text-fg-muted">
            Confirmed by {confirmedOthers.length} other
            {confirmedOthers.length === 1 ? '' : 's'}
          </span>
        ) : null}
      </header>
      <pre className="mt-2 whitespace-pre-wrap break-words text-sm text-fg-muted">{cleanBody}</pre>

      {citations && citations.length > 0 ? (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-fg-muted hover:text-fg">
            Show citations ({citations.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1 text-fg-muted">
            {citations.map((c, idx) => (
              <li key={idx} className="font-mono">
                {JSON.stringify(c)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <InsightActions
          insightId={insight.id}
          alreadyConfirmed={alreadyConfirmed}
          alreadyDismissed={alreadyDismissed}
        />
      </div>
    </article>
  );
}
