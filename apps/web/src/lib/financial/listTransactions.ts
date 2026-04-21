/**
 * `listTransactions` — server-side reader for `app.transaction`.
 *
 * Populates the Financial segment ledger (`/financial/transactions`) and the
 * "Upcoming autopays" strip on the Financial dashboard. Always runs under
 * the authed, RLS-enforced Supabase client so Postgres is the last line of
 * defense. The helper additionally enforces the caller's grant intersection
 * for the Financial segment — if the member lacks `financial:read`, we
 * short-circuit and return an empty list without a round trip.
 *
 * Rows come back as camelCase to match the rest of the web app's
 * convention; callers should never see raw snake_case column names.
 *
 * Includes light metadata joined from `app.account` (the account name) so
 * the ledger can render account labels without a second fetch. `member_id`
 * is carried through for member attribution but we do not join the member
 * row — member names are resolved upstream from the members list.
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';

export const TRANSACTION_SOURCES = ['ynab', 'email_receipt', 'plaid', 'monarch', 'manual'] as const;

export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

export const TRANSACTION_STATUSES = ['ambiguous_match', 'shadowed'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

const isoDateTime = z.string().refine((s) => !Number.isNaN(new Date(s).getTime()), {
  message: 'must be a valid ISO-8601 date-time',
});

export const listTransactionsArgsSchema = z.object({
  householdId: z.string().uuid(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  accountIds: z.array(z.string().uuid()).optional(),
  memberIds: z.array(z.string().uuid()).optional(),
  sources: z.array(z.string()).optional(),
  searchText: z.string().trim().min(1).max(200).optional(),
  includeShadowed: z.boolean().optional(),
  /**
   * Cursor: the `id` (ULID/UUID) of the last row seen in the previous
   * page. Combined with the stable `(occurred_at desc, id desc)` order,
   * callers that want page N+1 pass `before = lastRow.id`.
   */
  before: z.string().uuid().optional(),
  /** Optional before-date for the cursor; paired with `before` above. */
  beforeOccurredAt: isoDateTime.optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export type ListTransactionsArgs = z.infer<typeof listTransactionsArgsSchema>;

export interface TransactionRow {
  id: string;
  householdId: string;
  accountId: string | null;
  accountName: string | null;
  memberId: string | null;
  occurredAt: string;
  amountCents: number;
  currency: string;
  merchantRaw: string | null;
  category: string | null;
  source: string;
  sourceId: string | null;
  status: TransactionStatus | null;
  metadata: Record<string, unknown>;
}

type TransactionRowDb = Database['app']['Tables']['transaction']['Row'];
type AccountRowDb = Pick<Database['app']['Tables']['account']['Row'], 'id' | 'name'>;

type TransactionWithAccount = TransactionRowDb & {
  account: AccountRowDb | AccountRowDb[] | null;
};

function toCamel(row: TransactionWithAccount): TransactionRow {
  const metadata = row.metadata;
  const normalizedMeta =
    metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};

  const statusRaw = normalizedMeta['status'];
  const status =
    typeof statusRaw === 'string' && (TRANSACTION_STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as TransactionStatus)
      : null;

  const accountRaw = row.account;
  const account = Array.isArray(accountRaw) ? (accountRaw[0] ?? null) : accountRaw;

  return {
    id: row.id,
    householdId: row.household_id,
    accountId: row.account_id,
    accountName: account?.name ?? null,
    memberId: row.member_id,
    occurredAt: row.occurred_at,
    amountCents: row.amount_cents,
    currency: row.currency,
    merchantRaw: row.merchant_raw,
    category: row.category,
    source: row.source,
    sourceId: row.source_id,
    status,
    metadata: normalizedMeta,
  };
}

export interface SegmentGrant {
  segment: string;
  access: 'none' | 'read' | 'write';
}

export function hasFinancialRead(grants: readonly SegmentGrant[]): boolean {
  return grants.some(
    (g) => g.segment === 'financial' && (g.access === 'read' || g.access === 'write'),
  );
}

export interface ListTransactionsDeps {
  client?: ServerSupabaseClient;
  /**
   * Optional segment grants (from `getHouseholdContext()`). When provided,
   * the helper returns an empty list if the member lacks `financial:read`
   * before issuing any query.
   */
  grants?: readonly SegmentGrant[];
}

const DEFAULT_LIMIT = 100;

export async function listTransactions(
  args: ListTransactionsArgs,
  deps: ListTransactionsDeps = {},
): Promise<TransactionRow[]> {
  const parsed = listTransactionsArgsSchema.parse(args);

  if (deps.grants && !hasFinancialRead(deps.grants)) {
    return [];
  }

  const client = deps.client ?? (await createClient());

  let query = client
    .schema('app')
    .from('transaction')
    .select(
      'id, household_id, account_id, member_id, occurred_at, amount_cents, currency, merchant_raw, category, source, source_id, metadata, account:account_id(id, name)',
    )
    .eq('household_id', parsed.householdId);

  if (parsed.from) {
    query = query.gte('occurred_at', parsed.from);
  }
  if (parsed.to) {
    query = query.lt('occurred_at', parsed.to);
  }
  if (parsed.accountIds && parsed.accountIds.length > 0) {
    query = query.in('account_id', parsed.accountIds);
  }
  if (parsed.memberIds && parsed.memberIds.length > 0) {
    query = query.in('member_id', parsed.memberIds);
  }
  if (parsed.sources && parsed.sources.length > 0) {
    query = query.in('source', parsed.sources);
  }
  if (parsed.searchText) {
    // `ilike` in PostgREST expects `%…%` wildcards inline. Keep the
    // search case-insensitive and bounded to the merchant column for
    // now — the category and metadata searches are deferred to a real
    // FTS index.
    const like = `%${parsed.searchText.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    query = query.ilike('merchant_raw', like);
  }

  // Shadowed rows (metadata.status='shadowed') are hidden by default.
  // We filter via PostgREST's JSON-path operator (`metadata->>status`)
  // to keep the query index-friendly on the JSONB column.
  if (!parsed.includeShadowed) {
    query = query.or('metadata->>status.is.null,metadata->>status.neq.shadowed');
  }

  if (parsed.before && parsed.beforeOccurredAt) {
    // Stable cursor: everything strictly earlier than
    // (beforeOccurredAt, before). We approximate with a time bound +
    // id tie-break — good enough for MVP; a real keyset cursor would
    // use `(occurred_at, id) < (…, …)` via a materialized view.
    query = query.or(
      `occurred_at.lt.${parsed.beforeOccurredAt},and(occurred_at.eq.${parsed.beforeOccurredAt},id.lt.${parsed.before})`,
    );
  }

  query = query
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(parsed.limit ?? DEFAULT_LIMIT);

  const { data, error } = await query;
  if (error) {
    throw new Error(`listTransactions: ${error.message}`);
  }
  return (data ?? []).map((row) => toCamel(row as TransactionWithAccount));
}
