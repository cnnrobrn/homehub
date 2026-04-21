/**
 * `listAccounts` — server-side reader for `app.account`.
 *
 * Used by `/financial/accounts` (card grid) and the Financial dashboard's
 * account health strip. Always runs under the authed, RLS-enforced Supabase
 * client. Returns the raw account row plus a derived `staleDays` computed
 * from `last_synced_at`.
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { hasFinancialRead, type SegmentGrant } from './listTransactions';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';

const MS_PER_DAY = 86_400_000;
const STALE_THRESHOLD_HOURS = 24;

export const listAccountsArgsSchema = z.object({
  householdId: z.string().uuid(),
  accountIds: z.array(z.string().uuid()).optional(),
});

export type ListAccountsArgs = z.infer<typeof listAccountsArgsSchema>;

export interface AccountRow {
  id: string;
  householdId: string;
  ownerMemberId: string | null;
  name: string;
  kind: string;
  provider: string | null;
  currency: string;
  balanceCents: number | null;
  lastSyncedAt: string | null;
  staleDays: number | null;
  stale: boolean;
  createdAt: string;
  updatedAt: string;
}

type AccountRowDb = Database['app']['Tables']['account']['Row'];

function toCamel(row: AccountRowDb, now: Date): AccountRow {
  const lastSync = row.last_synced_at ? new Date(row.last_synced_at) : null;
  const staleDays =
    lastSync && !Number.isNaN(lastSync.getTime())
      ? (now.getTime() - lastSync.getTime()) / MS_PER_DAY
      : null;
  const stale =
    lastSync === null || (staleDays !== null && staleDays * 24 >= STALE_THRESHOLD_HOURS);
  return {
    id: row.id,
    householdId: row.household_id,
    ownerMemberId: row.owner_member_id,
    name: row.name,
    kind: row.kind,
    provider: row.provider,
    currency: row.currency,
    balanceCents: row.balance_cents,
    lastSyncedAt: row.last_synced_at,
    staleDays: staleDays === null ? null : Math.max(0, Math.round(staleDays * 10) / 10),
    stale,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ListAccountsDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
  /** Injectable clock for deterministic tests. Defaults to `new Date()`. */
  now?: Date;
}

export async function listAccounts(
  args: ListAccountsArgs,
  deps: ListAccountsDeps = {},
): Promise<AccountRow[]> {
  const parsed = listAccountsArgsSchema.parse(args);

  if (deps.grants && !hasFinancialRead(deps.grants)) {
    return [];
  }

  const client = deps.client ?? (await createClient());
  let query = client
    .schema('app')
    .from('account')
    .select(
      'id, household_id, owner_member_id, name, kind, provider, currency, balance_cents, last_synced_at, created_at, updated_at',
    )
    .eq('household_id', parsed.householdId);

  if (parsed.accountIds && parsed.accountIds.length > 0) {
    query = query.in('id', parsed.accountIds);
  }

  query = query.order('name', { ascending: true });

  const { data, error } = await query;
  if (error) throw new Error(`listAccounts: ${error.message}`);
  const now = deps.now ?? new Date();
  return (data ?? []).map((row) => toCamel(row as AccountRowDb, now));
}
