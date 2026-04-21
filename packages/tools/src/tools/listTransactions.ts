/**
 * `list_transactions` — paged window over `app.transaction`.
 *
 * Requires `financial:read`. Intersection with `app.account_grant` is
 * enforced by filtering on `account_id in (...)` — we pull the member's
 * readable accounts first, then restrict the transaction query.
 */

import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../types.js';

interface TxRow {
  id: string;
  account_id: string | null;
  amount_cents: number;
  currency: string;
  merchant_raw: string | null;
  category: string | null;
  occurred_at: string;
  member_id: string | null;
  source: string;
}

const inputSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  account_id: z.string().uuid().optional(),
  category: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

const txSchema = z.object({
  id: z.string(),
  account_id: z.string().nullable(),
  amount_cents: z.number(),
  currency: z.string(),
  merchant_raw: z.string().nullable(),
  category: z.string().nullable(),
  occurred_at: z.string(),
  member_id: z.string().nullable(),
  source: z.string(),
});

const outputSchema = z.object({ transactions: z.array(txSchema) });

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const listTransactionsTool: ToolDefinition<Input, Output> = {
  name: 'list_transactions',
  description:
    'List financial transactions in a date range, scoped to the caller’s accessible accounts.',
  class: 'read',
  input: inputSchema,
  output: outputSchema,
  segments: ['financial'],
  async handler(args, ctx) {
    if (new Date(args.to).getTime() <= new Date(args.from).getTime()) {
      return { transactions: [] };
    }
    // Pull the member's readable accounts.
    const { data: grants, error: grantErr } = await ctx.supabase
      .schema('app')
      .from('account_grant')
      .select('account_id, access')
      .eq('member_id', ctx.memberId);
    if (grantErr) throw new ToolError('db_error', `list_transactions grants: ${grantErr.message}`);
    const readableAccountIds = (grants ?? [])
      .filter((g) => g.access === 'read' || g.access === 'write')
      .map((g) => g.account_id);
    if (readableAccountIds.length === 0) return { transactions: [] };

    let q = ctx.supabase
      .schema('app')
      .from('transaction')
      .select(
        'id, account_id, amount_cents, currency, merchant_raw, category, occurred_at, member_id, source',
      )
      .eq('household_id', ctx.householdId)
      .gte('occurred_at', args.from)
      .lt('occurred_at', args.to)
      .in('account_id', readableAccountIds);
    if (args.account_id) {
      if (!readableAccountIds.includes(args.account_id)) {
        return { transactions: [] };
      }
      q = q.eq('account_id', args.account_id);
    }
    if (args.category) q = q.eq('category', args.category);
    q = q.order('occurred_at', { ascending: false }).limit(args.limit ?? 100);
    const { data, error } = await q;
    if (error) throw new ToolError('db_error', `list_transactions: ${error.message}`);
    return {
      transactions: (data ?? []).map((t: TxRow) => ({
        id: t.id,
        account_id: t.account_id,
        amount_cents: t.amount_cents,
        currency: t.currency,
        merchant_raw: t.merchant_raw,
        category: t.category,
        occurred_at: t.occurred_at,
        member_id: t.member_id,
        source: t.source,
      })),
    };
  },
};
