/**
 * `/fun/summaries` — paginated fun-segment summaries.
 */

import { getHouseholdContext } from '@/lib/auth/context';
import { listFunSummaries, type SegmentGrant } from '@/lib/fun';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default async function FunSummariesPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;
  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));
  const summaries = await listFunSummaries(
    { householdId: ctx.household.id, limit: 12 },
    { grants },
  );

  if (summaries.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
        No fun summaries yet. They generate after the summaries worker runs for a period with fun
        events.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {summaries.map((s) => (
        <article key={s.id} className="rounded-lg border border-border bg-surface p-4">
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-fg">
              {s.period === 'weekly'
                ? 'Weekly recap'
                : s.period === 'monthly'
                  ? 'Monthly recap'
                  : 'Recap'}
            </h3>
            <span className="text-xs text-fg-muted">
              {formatDate(s.coveredStart)} – {formatDate(s.coveredEnd)}
            </span>
          </header>
          <pre className="mt-2 whitespace-pre-wrap text-sm text-fg">{s.bodyMd}</pre>
        </article>
      ))}
    </div>
  );
}
