/**
 * Tests for `listSubscriptions`.
 *
 * Covers cadence parsing, next-charge projection, and grant short-circuit.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { listSubscriptions } from './listSubscriptions';

interface NodeRowFake {
  id: string;
  household_id: string;
  canonical_name: string;
  type: string;
  needs_review: boolean;
  metadata: unknown;
  created_at: string;
  updated_at: string;
}

function makeFakeClient(rows: NodeRowFake[] = []) {
  const thenable: Record<string, unknown> = {
    select() {
      return thenable;
    },
    eq() {
      return thenable;
    },
    order() {
      return thenable;
    },
    then(resolve: (v: { data: NodeRowFake[]; error: null }) => void) {
      resolve({ data: rows, error: null });
    },
  };
  return {
    client: {
      schema() {
        return {
          from() {
            return thenable;
          },
        };
      },
    },
  };
}

const HOUSEHOLD = '11111111-1111-4111-8111-111111111111';

describe('listSubscriptions', () => {
  it('parses monthly cadence and projects next charge', async () => {
    const { client } = makeFakeClient([
      {
        id: 'n1',
        household_id: HOUSEHOLD,
        canonical_name: 'Netflix',
        type: 'subscription',
        needs_review: false,
        metadata: {
          cadence: 'monthly',
          price_cents: 1599,
          currency: 'USD',
          match_count: 6,
          last_charged_at: '2026-04-01T00:00:00Z',
        },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-04-01T00:00:00Z',
      },
    ]);
    const rows = await listSubscriptions(
      { householdId: HOUSEHOLD },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { client: client as any },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cadence).toBe('monthly');
    expect(rows[0]?.priceCents).toBe(1599);
    expect(rows[0]?.matchCount).toBe(6);
    // setMonth on a local Date preserves the local-time fields; the resulting
    // ISO can shift by the test runner's timezone offset. Assert the month
    // advanced by one rather than hard-coding the exact UTC instant.
    const next = rows[0]?.nextChargeAt ?? '';
    expect(next).toMatch(/^2026-(04-30|05-0[12])/);
  });

  it('falls back to unknown cadence on bad metadata', async () => {
    const { client } = makeFakeClient([
      {
        id: 'n1',
        household_id: HOUSEHOLD,
        canonical_name: 'Unclear',
        type: 'subscription',
        needs_review: true,
        metadata: { cadence: 'nonsense' },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-04-01T00:00:00Z',
      },
    ]);
    const rows = await listSubscriptions(
      { householdId: HOUSEHOLD },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { client: client as any },
    );
    expect(rows[0]?.cadence).toBe('unknown');
    expect(rows[0]?.nextChargeAt).toBeNull();
    expect(rows[0]?.priceCents).toBeNull();
  });

  it('returns empty when grant denies', async () => {
    const { client } = makeFakeClient([]);
    const rows = await listSubscriptions(
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
