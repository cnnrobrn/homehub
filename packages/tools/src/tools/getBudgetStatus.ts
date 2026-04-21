/**
 * `get_budget_status` — current `app.budget` rows vs. month-to-date spend.
 *
 * Requires `financial:read`. We compute the window as the current month
 * in UTC. Budgets with `period = 'weekly'` fall back to the current
 * ISO week. `spent_cents` is `SUM(amount_cents)` over matching
 * transactions in readable accounts.
 */

import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../types.js';

import type { Database } from '@homehub/db';

type BudgetRow = Database['app']['Tables']['budget']['Row'];
type TxRow = Database['app']['Tables']['transaction']['Row'];

const inputSchema = z.object({});

const outputSchema = z.object({
  as_of: z.string(),
  budgets: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      category: z.string(),
      period: z.string(),
      currency: z.string(),
      amount_cents: z.number(),
      spent_cents: z.number(),
      remaining_cents: z.number(),
      window_start: z.string(),
      window_end: z.string(),
    }),
  ),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

function monthWindow(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}
function weekWindow(now: Date): { start: Date; end: Date } {
  const day = now.getUTCDay(); // 0 = Sunday
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { start, end };
}

export const getBudgetStatusTool: ToolDefinition<Input, Output> = {
  name: 'get_budget_status',
  description: 'Current budgets for the household vs. spend in the current period.',
  class: 'read',
  input: inputSchema,
  output: outputSchema,
  segments: ['financial'],
  async handler(_args, ctx) {
    const now = ctx.now ? ctx.now() : new Date();

    const { data: grants, error: grantErr } = await ctx.supabase
      .schema('app')
      .from('account_grant')
      .select('account_id, access')
      .eq('member_id', ctx.memberId);
    if (grantErr) throw new ToolError('db_error', `get_budget_status grants: ${grantErr.message}`);
    const accountIds = (grants ?? [])
      .filter((g) => g.access === 'read' || g.access === 'write')
      .map((g) => g.account_id);

    const { data: budgets, error: bErr } = await ctx.supabase
      .schema('app')
      .from('budget')
      .select('id, name, category, period, currency, amount_cents')
      .eq('household_id', ctx.householdId);
    if (bErr) throw new ToolError('db_error', `get_budget_status budgets: ${bErr.message}`);

    const out: Output['budgets'] = [];
    for (const b of (budgets ?? []) as BudgetRow[]) {
      const window = b.period === 'weekly' ? weekWindow(now) : monthWindow(now);
      let spent = 0;
      if (accountIds.length > 0) {
        const { data: txs, error: txErr } = await ctx.supabase
          .schema('app')
          .from('transaction')
          .select('amount_cents, category, account_id')
          .eq('household_id', ctx.householdId)
          .eq('category', b.category)
          .in('account_id', accountIds)
          .gte('occurred_at', window.start.toISOString())
          .lt('occurred_at', window.end.toISOString());
        if (txErr) throw new ToolError('db_error', `get_budget_status spend: ${txErr.message}`);
        spent = (txs ?? []).reduce(
          (acc: number, t: Partial<TxRow>) => acc + (t.amount_cents ?? 0),
          0,
        );
      }
      out.push({
        id: b.id,
        name: b.name,
        category: b.category,
        period: b.period,
        currency: b.currency,
        amount_cents: b.amount_cents,
        spent_cents: spent,
        remaining_cents: b.amount_cents - spent,
        window_start: window.start.toISOString(),
        window_end: window.end.toISOString(),
      });
    }
    return { as_of: now.toISOString(), budgets: out };
  },
};
