/**
 * Tests for `listAccounts`.
 *
 * Covers staleness computation and grant short-circuit.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { listAccounts } from './listAccounts';

interface FakeRow {
  id: string;
  household_id: string;
  owner_member_id: string | null;
  name: string;
  kind: string;
  provider: string | null;
  currency: string;
  balance_cents: number | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

function makeFakeClient(rows: FakeRow[] = []) {
  const thenable = {
    select(_cols: string) {
      return thenable;
    },

    eq(_col: string, _value: unknown) {
      return thenable;
    },

    in(_col: string, _value: unknown) {
      return thenable;
    },

    order(_col: string, _opts: { ascending: boolean }) {
      return thenable;
    },
    then(resolve: (v: { data: FakeRow[]; error: null }) => void) {
      resolve({ data: rows, error: null });
    },
  };
  const client = {
    schema() {
      return {
        from() {
          return thenable;
        },
      };
    },
  };
  return { client };
}

const HOUSEHOLD = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-04-20T12:00:00Z');

describe('listAccounts', () => {
  it('marks an account stale when last_synced_at > 24h ago', async () => {
    const row: FakeRow = {
      id: 'a1',
      household_id: HOUSEHOLD,
      owner_member_id: null,
      name: 'Main',
      kind: 'checking',
      provider: 'ynab',
      currency: 'USD',
      balance_cents: 100_00,
      last_synced_at: '2026-04-17T12:00:00Z', // 3 days ago
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-04-17T12:00:00Z',
    };
    const { client } = makeFakeClient([row]);
    const rows = await listAccounts(
      { householdId: HOUSEHOLD },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { client: client as any, now: NOW },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.stale).toBe(true);
    expect(rows[0]?.staleDays).toBe(3);
  });

  it('marks a fresh account not-stale', async () => {
    const row: FakeRow = {
      id: 'a2',
      household_id: HOUSEHOLD,
      owner_member_id: null,
      name: 'Main',
      kind: 'checking',
      provider: 'ynab',
      currency: 'USD',
      balance_cents: 100_00,
      last_synced_at: '2026-04-20T06:00:00Z', // 6h ago
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-04-20T06:00:00Z',
    };
    const { client } = makeFakeClient([row]);
    const rows = await listAccounts(
      { householdId: HOUSEHOLD },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { client: client as any, now: NOW },
    );
    expect(rows[0]?.stale).toBe(false);
  });

  it('returns empty when member lacks financial:read', async () => {
    const { client } = makeFakeClient([]);
    const rows = await listAccounts(
      { householdId: HOUSEHOLD },
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client: client as any,
        grants: [{ segment: 'financial', access: 'none' }],
      },
    );
    expect(rows).toEqual([]);
  });
});
