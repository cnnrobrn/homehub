/**
 * `/food/summaries` — paginated weekly / monthly food summaries.
 */

import { getHouseholdContext } from '@/lib/auth/context';
import { listFoodSummaries, type SegmentGrant } from '@/lib/food';

export default async function FoodSummariesPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;
  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));
  const summaries = await listFoodSummaries(
    { householdId: ctx.household.id, limit: 12 },
    { grants },
  );
  if (summaries.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
        No summaries yet. They generate after the summaries worker runs for a period with meals.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {summaries.map((s) => (
        <article
          key={s.id}
          className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-sm"
        >
          <header className="flex items-baseline justify-between text-xs text-fg-muted">
            <span className="font-medium uppercase tracking-wide">{s.period}</span>
            <span>
              {new Date(s.coveredStart).toLocaleDateString()} –{' '}
              {new Date(s.coveredEnd).toLocaleDateString()}
            </span>
          </header>
          <pre className="whitespace-pre-wrap font-sans text-sm text-fg">{s.bodyMd}</pre>
        </article>
      ))}
    </div>
  );
}
