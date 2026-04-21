/**
 * Unit tests for `listTrips`.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { listTrips } from './listTrips';

interface Row {
  [k: string]: unknown;
}

function makeClient(rows: Row[]) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve({ data: rows, error: null })),
  };
  return {
    schema: vi.fn(() => ({
      from: vi.fn(() => chain),
    })),
  } as never;
}

describe('listTrips', () => {
  const HOUSEHOLD = '11111111-1111-4111-8111-111111111111';

  it('returns camelCased trip rows', async () => {
    const client = makeClient([
      {
        id: 't-1',
        household_id: HOUSEHOLD,
        segment: 'fun',
        kind: 'trip',
        title: 'Weekend in Montreal',
        starts_at: '2026-04-26T08:00:00Z',
        ends_at: '2026-04-28T22:00:00Z',
        all_day: false,
        location: 'Montreal',
        provider: null,
        metadata: { trip_id: 't-1' },
        owner_member_id: 'm-1',
      },
    ]);

    const out = await listTrips(
      { householdId: HOUSEHOLD },
      { client, grants: [{ segment: 'fun', access: 'read' }] },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe('Weekend in Montreal');
    expect(out[0]!.startsAt).toBe('2026-04-26T08:00:00Z');
    expect(out[0]!.metadata).toEqual({ trip_id: 't-1' });
  });

  it('returns empty when caller lacks fun:read', async () => {
    const client = makeClient([{ id: 't-1' }]);
    const out = await listTrips(
      { householdId: HOUSEHOLD },
      { client, grants: [{ segment: 'financial', access: 'read' }] },
    );
    expect(out).toEqual([]);
  });

  it('rejects invalid input', async () => {
    await expect(listTrips({ householdId: 'not-a-uuid' })).rejects.toThrow();
  });
});
