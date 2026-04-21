/**
 * `budget_over_threshold` detector.
 *
 * Spec: `specs/06-segments/financial/summaries-alerts.md`.
 *
 * Algorithm:
 *   For each budget, sum the absolute outflow (negative amounts) of all
 *   same-period transactions whose category matches the budget category.
 *   Emit:
 *     - `warn`     at 80% of the budget amount
 *     - `critical` at 100% of the budget amount
 *
 * The 100% alert supersedes the 80% alert — we don't emit both in the
 * same run (the 24h dedupe window keeps the 80% alert present if
 * spend retreats under 100% later). That matches the spec's "80% warn
 * / 100% critical" ladder.
 *
 * Dedupe key: `${budgetId}:${periodStart}`. The period start is the
 * first day of the current week / month / year for the budget's period,
 * in UTC — good enough as long as the worker runs once per day; spec
 * notes household-tz sensitivity as a post-v1 concern.
 */

import { type BudgetRow, type TransactionRow, type AlertEmission } from '../types.js';

export interface BudgetThresholdInput {
  householdId: string;
  budgets: BudgetRow[];
  /** Transactions used for MTD / WTD / YTD spend. */
  transactions: TransactionRow[];
  now: Date;
}

export const BUDGET_WARN_PCT = 0.8;
export const BUDGET_CRITICAL_PCT = 1.0;

export function detectBudgetOverThreshold(input: BudgetThresholdInput): AlertEmission[] {
  const out: AlertEmission[] = [];
  for (const budget of input.budgets) {
    const periodStart = startOfPeriod(input.now, budget.period);
    const periodStartIso = periodStart.toISOString();
    const spentCents = sumOutflowForBudget(input.transactions, budget, periodStart);
    if (budget.amount_cents <= 0) continue;

    const pct = spentCents / budget.amount_cents;
    const dedupeKey = `${budget.id}:${periodStart.toISOString().slice(0, 10)}`;

    if (pct >= BUDGET_CRITICAL_PCT) {
      out.push({
        segment: 'financial',
        severity: 'critical',
        kind: 'budget_over_threshold',
        dedupeKey,
        title: `Over budget: ${budget.name}`,
        body: `Spent ${formatCents(spentCents)} of ${formatCents(budget.amount_cents)} this ${budget.period} (${Math.round(pct * 100)}%).`,
        context: {
          budget_id: budget.id,
          category: budget.category,
          period: budget.period,
          period_start: periodStartIso,
          spent_cents: spentCents,
          amount_cents: budget.amount_cents,
          pct,
        },
      });
      continue;
    }
    if (pct >= BUDGET_WARN_PCT) {
      out.push({
        segment: 'financial',
        severity: 'warn',
        kind: 'budget_over_threshold',
        dedupeKey,
        title: `Nearing budget: ${budget.name}`,
        body: `Spent ${formatCents(spentCents)} of ${formatCents(budget.amount_cents)} this ${budget.period} (${Math.round(pct * 100)}%).`,
        context: {
          budget_id: budget.id,
          category: budget.category,
          period: budget.period,
          period_start: periodStartIso,
          spent_cents: spentCents,
          amount_cents: budget.amount_cents,
          pct,
        },
      });
    }
  }
  return out;
}

function sumOutflowForBudget(
  transactions: TransactionRow[],
  budget: BudgetRow,
  periodStart: Date,
): number {
  let total = 0;
  const budgetCat = normalizeCategory(budget.category);
  const startMs = periodStart.getTime();
  for (const tx of transactions) {
    if (tx.household_id !== budget.household_id) continue;
    if (tx.amount_cents >= 0) continue; // only outflows count against spend budget
    if (!tx.category) continue;
    if (normalizeCategory(tx.category) !== budgetCat) continue;
    const ts = new Date(tx.occurred_at).getTime();
    if (!Number.isFinite(ts) || ts < startMs) continue;
    total += Math.abs(tx.amount_cents);
  }
  return total;
}

function normalizeCategory(c: string): string {
  return c.trim().toLowerCase();
}

/**
 * Start of the current period in UTC. Week start = Monday (ISO-8601).
 * Good enough for v1; household-tz scheduling is a later concern.
 */
export function startOfPeriod(now: Date, period: 'weekly' | 'monthly' | 'yearly'): Date {
  if (period === 'weekly') {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
    );
    const dow = d.getUTCDay(); // 0 = Sunday
    const mondayOffset = dow === 0 ? 6 : dow - 1;
    d.setUTCDate(d.getUTCDate() - mondayOffset);
    return d;
  }
  if (period === 'monthly') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
}

function formatCents(n: number): string {
  return `$${(n / 100).toFixed(2)}`;
}
