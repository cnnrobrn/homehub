/**
 * `listBudgets` — server-side reader for `app.budget`.
 *
 * Powers `/financial/budgets`. Returns the budget row plus month-to-date
 * spend computed at read-time per the budget's period. We resolve the
 * month window server-side (defaults to the current calendar month) and
 * aggregate `app.transaction.amount_cents` by matching `category`.
 *
 * Spend is computed from non-shadowed transactions only. Matching is
 * case-insensitive on the category string to tolerate upstream casing
 * drift from YNAB.
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { hasFinancialRead, type SegmentGrant } from './listTransactions';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';

export const listBudgetsArgsSchema = z.object({
  householdId: z.string().uuid(),
  /** Start of the period to compute spend against (ISO-8601). */
  monthStart: z.string().optional(),
});

export type ListBudgetsArgs = z.infer<typeof listBudgetsArgsSchema>;

export interface BudgetRow {
  id: string;
  householdId: string;
  name: string;
  category: string;
  amountCents: number;
  spentCents: number;
  currency: string;
  period: string;
  progress: number;
  overBudget: boolean;
  nearBudget: boolean;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  updatedAt: string;
}

type BudgetRowDb = Database['app']['Tables']['budget']['Row'];
type TransactionRowDb = Pick<
  Database['app']['Tables']['transaction']['Row'],
  'amount_cents' | 'category' | 'metadata'
>;

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0);
}

export interface ListBudgetsDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
  now?: Date;
}

export async function listBudgets(
  args: ListBudgetsArgs,
  deps: ListBudgetsDeps = {},
): Promise<BudgetRow[]> {
  const parsed = listBudgetsArgsSchema.parse(args);

  if (deps.grants && !hasFinancialRead(deps.grants)) {
    return [];
  }

  const client = deps.client ?? (await createClient());
  const now = deps.now ?? new Date();
  const periodStart = parsed.monthStart ? new Date(parsed.monthStart) : startOfMonth(now);
  if (Number.isNaN(periodStart.getTime())) {
    throw new Error('listBudgets: invalid monthStart');
  }
  const periodEnd = endOfMonth(periodStart);

  const { data: budgetRows, error: budgetErr } = await client
    .schema('app')
    .from('budget')
    .select(
      'id, household_id, name, category, amount_cents, currency, period, created_at, updated_at',
    )
    .eq('household_id', parsed.householdId)
    .order('name', { ascending: true });

  if (budgetErr) throw new Error(`listBudgets: ${budgetErr.message}`);
  const budgets = (budgetRows ?? []) as BudgetRowDb[];
  if (budgets.length === 0) return [];

  // Pull the subset of transactions we need to compute spend. Category
  // list is deduped on the client to keep the `IN (…)` short.
  const categories = Array.from(new Set(budgets.map((b) => b.category).filter(Boolean)));
  let txQuery = client
    .schema('app')
    .from('transaction')
    .select('amount_cents, category, metadata')
    .eq('household_id', parsed.householdId)
    .gte('occurred_at', periodStart.toISOString())
    .lt('occurred_at', periodEnd.toISOString())
    .or('metadata->>status.is.null,metadata->>status.neq.shadowed');

  if (categories.length > 0) {
    txQuery = txQuery.in('category', categories);
  }

  const { data: txRows, error: txErr } = await txQuery;
  if (txErr) throw new Error(`listBudgets: ${txErr.message}`);
  const txs = (txRows ?? []) as TransactionRowDb[];

  const spendByCategory = new Map<string, number>();
  for (const tx of txs) {
    const key = (tx.category ?? '').toLowerCase();
    if (!key) continue;
    // Outflows only: YNAB + email-receipt rows record spend as a
    // positive cents value; income (if category-tagged) would come in
    // negative. Match that convention and only sum positive values.
    const amount = tx.amount_cents;
    if (amount > 0) {
      spendByCategory.set(key, (spendByCategory.get(key) ?? 0) + amount);
    }
  }

  return budgets.map((b) => {
    const spent = spendByCategory.get((b.category ?? '').toLowerCase()) ?? 0;
    const progress = b.amount_cents > 0 ? spent / b.amount_cents : 0;
    return {
      id: b.id,
      householdId: b.household_id,
      name: b.name,
      category: b.category,
      amountCents: b.amount_cents,
      spentCents: spent,
      currency: b.currency,
      period: b.period,
      progress,
      overBudget: progress > 1,
      nearBudget: progress >= 0.8 && progress <= 1,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      createdAt: b.created_at,
      updatedAt: b.updated_at,
    };
  });
}
