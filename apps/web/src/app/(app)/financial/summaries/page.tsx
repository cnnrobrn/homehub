/**
 * `/financial/summaries` — paginated weekly / monthly summaries.
 *
 * Server Component. Reads `app.summary where segment='financial'`
 * ordered by `covered_start desc`, limit 12.
 */

import { FinancialSummaryCard } from '@/components/financial/FinancialSummaryCard';
import { getHouseholdContext } from '@/lib/auth/context';
import { listFinancialSummaries, type SegmentGrant } from '@/lib/financial';

export default async function SummariesPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;
  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));
  const summaries = await listFinancialSummaries(
    { householdId: ctx.household.id, limit: 12 },
    { grants },
  );

  if (summaries.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
        No summaries yet. They generate after the summaries worker runs for a period with
        transactions.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {summaries.map((s) => (
        <FinancialSummaryCard key={s.id} summary={s} />
      ))}
    </div>
  );
}
