/**
 * `/financial/budgets` — per-category budget progress.
 *
 * Server Component. Progress is computed at read time against the
 * current month by default.
 */

import { BudgetProgress } from '@/components/financial/BudgetProgress';
import { getHouseholdContext } from '@/lib/auth/context';
import { listBudgets, type SegmentGrant } from '@/lib/financial';

export default async function BudgetsPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;
  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));
  const budgets = await listBudgets({ householdId: ctx.household.id }, { grants });

  if (budgets.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
        No budgets yet. HomeHub mirrors budgets from your connected budgeting app.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {budgets.map((b) => (
        <BudgetProgress key={b.id} budget={b} />
      ))}
    </div>
  );
}
