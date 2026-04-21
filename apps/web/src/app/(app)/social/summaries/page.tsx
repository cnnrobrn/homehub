/**
 * `/social/summaries` — paginated weekly / monthly summaries.
 */

import { getHouseholdContext } from '@/lib/auth/context';
import { listSocialSummaries, type SegmentGrant } from '@/lib/social';

export default async function SummariesPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;
  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));
  const summaries = await listSocialSummaries(
    { householdId: ctx.household.id, limit: 12 },
    { grants },
  );

  if (summaries.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
        No summaries yet. They generate after the summaries worker runs for a period with activity.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {summaries.map((s) => (
        <article key={s.id} className="rounded-lg border border-border bg-surface p-4 text-sm">
          <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold text-fg">
              {s.period === 'weekly' ? 'Weekly social brief' : 'Monthly social brief'}
            </h3>
            <span className="text-xs text-fg-muted">
              {new Date(s.coveredStart).toLocaleDateString()} –{' '}
              {new Date(s.coveredEnd).toLocaleDateString()}
            </span>
          </header>
          <pre className="whitespace-pre-wrap font-sans leading-6 text-fg">{s.bodyMd}</pre>
        </article>
      ))}
    </div>
  );
}
