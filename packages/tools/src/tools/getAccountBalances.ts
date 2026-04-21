/**
 * `get_account_balances` — member's visible accounts per grants.
 *
 * Requires `financial:read`. Returns the intersection of `app.account`
 * with `app.account_grant` rows granting this member `read` or `write`.
 */

import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../types.js';

import type { Database } from '@homehub/db';

type AccountRow = Database['app']['Tables']['account']['Row'];

const inputSchema = z.object({});
const outputSchema = z.object({
  accounts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: z.string(),
      currency: z.string(),
      balance_cents: z.number().nullable(),
      provider: z.string().nullable(),
      last_synced_at: z.string().nullable(),
      owner_member_id: z.string().nullable(),
    }),
  ),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const getAccountBalancesTool: ToolDefinition<Input, Output> = {
  name: 'get_account_balances',
  description: 'Balances for accounts the caller has access to.',
  class: 'read',
  input: inputSchema,
  output: outputSchema,
  segments: ['financial'],
  async handler(_args, ctx) {
    const { data: grants, error: grantErr } = await ctx.supabase
      .schema('app')
      .from('account_grant')
      .select('account_id, access')
      .eq('member_id', ctx.memberId);
    if (grantErr)
      throw new ToolError('db_error', `get_account_balances grants: ${grantErr.message}`);
    const ids = (grants ?? [])
      .filter((g) => g.access === 'read' || g.access === 'write')
      .map((g) => g.account_id);
    if (ids.length === 0) return { accounts: [] };

    const { data, error } = await ctx.supabase
      .schema('app')
      .from('account')
      .select('id, name, kind, currency, balance_cents, provider, last_synced_at, owner_member_id')
      .eq('household_id', ctx.householdId)
      .in('id', ids)
      .order('name', { ascending: true });
    if (error) throw new ToolError('db_error', `get_account_balances: ${error.message}`);
    return {
      accounts: (data ?? []).map((a: Partial<AccountRow>) => ({
        id: a.id!,
        name: a.name!,
        kind: a.kind!,
        currency: a.currency!,
        balance_cents: a.balance_cents ?? null,
        provider: a.provider ?? null,
        last_synced_at: a.last_synced_at ?? null,
        owner_member_id: a.owner_member_id ?? null,
      })),
    };
  },
};
