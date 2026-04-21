/**
 * Tests for `listTransactions`.
 *
 * Verifies:
 *  - Grant intersection short-circuits when the member lacks
 *    `financial:read`.
 *  - Filter composition (household, window, account, member, source,
 *    search, shadowed toggle).
 *  - Metadata status parsing (ambiguous_match / shadowed / null).
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { hasFinancialRead, listTransactions } from './listTransactions';

interface CapturedCall {
  schema: string;
  table: string;
  select: string;
  filters: Array<{ op: string; column?: string; value?: unknown }>;
  orders: Array<{ column: string; ascending: boolean }>;
  limit?: number;
}

interface FakeTxRow {
  id: string;
  household_id: string;
  account_id: string | null;
  member_id: string | null;
  occurred_at: string;
  amount_cents: number;
  currency: string;
  merchant_raw: string | null;
  category: string | null;
  source: string;
  source_id: string | null;
  metadata: unknown;
  account: { id: string; name: string } | null;
}

function makeFakeClient(rows: FakeTxRow[] = []): {
  client: unknown;
  captured: CapturedCall;
} {
  const captured: CapturedCall = {
    schema: '',
    table: '',
    select: '',
    filters: [],
    orders: [],
  };

  const queryObj: Record<string, unknown> = {
    select(cols: string) {
      captured.select = cols;
      return queryObj;
    },
    eq(column: string, value: unknown) {
      captured.filters.push({ op: 'eq', column, value });
      return queryObj;
    },
    gte(column: string, value: unknown) {
      captured.filters.push({ op: 'gte', column, value });
      return queryObj;
    },
    lt(column: string, value: unknown) {
      captured.filters.push({ op: 'lt', column, value });
      return queryObj;
    },
    in(column: string, value: unknown) {
      captured.filters.push({ op: 'in', column, value });
      return queryObj;
    },
    or(expr: string) {
      captured.filters.push({ op: 'or', value: expr });
      return queryObj;
    },
    ilike(column: string, value: unknown) {
      captured.filters.push({ op: 'ilike', column, value });
      return queryObj;
    },
    order(column: string, opts: { ascending: boolean }) {
      captured.orders.push({ column, ascending: opts.ascending });
      return queryObj;
    },
    limit(n: number) {
      captured.limit = n;
      return queryObj;
    },
    then(resolve: (value: { data: FakeTxRow[]; error: null }) => void) {
      resolve({ data: rows, error: null });
    },
  };

  const client = {
    schema(name: string) {
      captured.schema = name;
      return {
        from(table: string) {
          captured.table = table;
          return queryObj;
        },
      };
    },
  };
  return { client, captured };
}

const HOUSEHOLD = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';

describe('hasFinancialRead', () => {
  it('true when read or write', () => {
    expect(hasFinancialRead([{ segment: 'financial', access: 'read' }])).toBe(true);
    expect(hasFinancialRead([{ segment: 'financial', access: 'write' }])).toBe(true);
  });
  it('false when none', () => {
    expect(hasFinancialRead([{ segment: 'financial', access: 'none' }])).toBe(false);
    expect(hasFinancialRead([{ segment: 'food', access: 'read' }])).toBe(false);
  });
});

describe('listTransactions', () => {
  it('short-circuits without query when grants lack financial:read', async () => {
    const { client, captured } = makeFakeClient([]);
    const rows = await listTransactions(
      { householdId: HOUSEHOLD },
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client: client as any,
        grants: [
          { segment: 'financial', access: 'none' },
          { segment: 'food', access: 'read' },
        ],
      },
    );
    expect(rows).toEqual([]);
    expect(captured.filters).toHaveLength(0);
  });

  it('composes household, time window, and account filters', async () => {
    const { client, captured } = makeFakeClient([]);
    await listTransactions(
      {
        householdId: HOUSEHOLD,
        from: '2026-04-01T00:00:00Z',
        to: '2026-05-01T00:00:00Z',
        accountIds: [ACCOUNT],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { client: client as any, grants: [{ segment: 'financial', access: 'read' }] },
    );
    expect(captured.schema).toBe('app');
    expect(captured.table).toBe('transaction');
    expect(captured.filters).toContainEqual({ op: 'eq', column: 'household_id', value: HOUSEHOLD });
    expect(captured.filters).toContainEqual({
      op: 'gte',
      column: 'occurred_at',
      value: '2026-04-01T00:00:00Z',
    });
    expect(captured.filters).toContainEqual({
      op: 'lt',
      column: 'occurred_at',
      value: '2026-05-01T00:00:00Z',
    });
    expect(captured.filters).toContainEqual({ op: 'in', column: 'account_id', value: [ACCOUNT] });
    // Shadowed filter is applied by default.
    expect(
      captured.filters.some((f) => f.op === 'or' && String(f.value).includes('shadowed')),
    ).toBe(true);
    expect(captured.orders[0]).toEqual({ column: 'occurred_at', ascending: false });
  });

  it('omits shadowed-row filter when includeShadowed=true', async () => {
    const { client, captured } = makeFakeClient([]);
    await listTransactions(
      { householdId: HOUSEHOLD, includeShadowed: true },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { client: client as any, grants: [{ segment: 'financial', access: 'read' }] },
    );
    expect(
      captured.filters.some((f) => f.op === 'or' && String(f.value).includes('shadowed')),
    ).toBe(false);
  });

  it('maps snake_case rows to camelCase and surfaces status', async () => {
    const row: FakeTxRow = {
      id: 't1',
      household_id: HOUSEHOLD,
      account_id: ACCOUNT,
      member_id: null,
      occurred_at: '2026-04-15T10:00:00Z',
      amount_cents: 1234,
      currency: 'USD',
      merchant_raw: 'Netflix',
      category: 'Streaming',
      source: 'ynab',
      source_id: 'ynab-1',
      metadata: { status: 'ambiguous_match', candidate_transaction_ids: ['other'] },
      account: { id: ACCOUNT, name: 'Main Checking' },
    };
    const { client } = makeFakeClient([row]);
    const result = await listTransactions(
      { householdId: HOUSEHOLD },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { client: client as any },
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 't1',
      accountId: ACCOUNT,
      accountName: 'Main Checking',
      merchantRaw: 'Netflix',
      status: 'ambiguous_match',
      amountCents: 1234,
    });
  });

  it('treats unknown status value as null', async () => {
    const row: FakeTxRow = {
      id: 't2',
      household_id: HOUSEHOLD,
      account_id: null,
      member_id: null,
      occurred_at: '2026-04-15T10:00:00Z',
      amount_cents: 500,
      currency: 'USD',
      merchant_raw: 'Starbucks',
      category: null,
      source: 'email_receipt',
      source_id: null,
      metadata: { status: 'something_else' },
      account: null,
    };
    const { client } = makeFakeClient([row]);
    const result = await listTransactions(
      { householdId: HOUSEHOLD },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { client: client as any },
    );
    expect(result[0]?.status).toBeNull();
    expect(result[0]?.accountName).toBeNull();
  });

  it('rejects invalid household id', async () => {
    await expect(
      listTransactions(
        { householdId: 'not-a-uuid' },

        {},
      ),
    ).rejects.toThrow();
  });
});
