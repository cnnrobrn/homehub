/**
 * Tests for `listEvents`.
 *
 * We mock the Supabase client to capture the query shape the helper
 * composes. The goal is to verify:
 *   1. Filter composition (household, window bounds, segment `in`).
 *   2. Segment-grant intersection (deny grants trim the filter).
 *   3. Early return when the intersection collapses to empty.
 *   4. Row mapping snake_case → camelCase.
 */

import { describe, expect, it, vi } from 'vitest';

// Mock the server-side Supabase client so the helper never tries to
// build a real one (env validation would otherwise fail in unit tests).
// `vi.mock` is hoisted to the top of the file by Vitest.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { type ListEventsArgs, allowedSegments, listEvents, type SegmentGrant } from './listEvents';

interface CapturedCall {
  schema: string;
  table: string;
  select: string;
  filters: Array<{ op: string; column?: string; value?: unknown }>;
  order?: { column: string; ascending: boolean };
  limit?: number;
}

interface FakeRow {
  id: string;
  household_id: string;
  owner_member_id: string | null;
  segment: string;
  kind: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  provider: string | null;
  metadata: unknown;
}

function makeFakeClient(rows: FakeRow[] = []): {
  client: unknown;
  captured: CapturedCall;
} {
  const captured: CapturedCall = {
    schema: '',
    table: '',
    select: '',
    filters: [],
  };

  const queryObj = {
    select(cols: string) {
      captured.select = cols;
      return queryObj;
    },
    eq(column: string, value: unknown) {
      captured.filters.push({ op: 'eq', column, value });
      return queryObj;
    },
    lt(column: string, value: unknown) {
      captured.filters.push({ op: 'lt', column, value });
      return queryObj;
    },
    or(expr: string) {
      captured.filters.push({ op: 'or', value: expr });
      return queryObj;
    },
    in(column: string, value: unknown) {
      captured.filters.push({ op: 'in', column, value });
      return queryObj;
    },
    order(column: string, opts: { ascending: boolean }) {
      captured.order = { column, ascending: opts.ascending };
      return queryObj;
    },
    limit(n: number) {
      captured.limit = n;
      return queryObj;
    },
    // Final await on the thenable shape Supabase uses.
    then(resolve: (value: { data: FakeRow[]; error: null }) => void) {
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
const FROM = '2026-04-20T00:00:00.000Z';
const TO = '2026-04-27T00:00:00.000Z';

function baseArgs(): ListEventsArgs {
  return { householdId: HOUSEHOLD, from: FROM, to: TO };
}

describe('allowedSegments', () => {
  it('returns only segments with read or write access', () => {
    const grants: SegmentGrant[] = [
      { segment: 'financial', access: 'none' },
      { segment: 'food', access: 'read' },
      { segment: 'fun', access: 'write' },
      { segment: 'social', access: 'none' },
      { segment: 'system', access: 'read' },
    ];
    expect(allowedSegments(grants).sort()).toEqual(['food', 'fun', 'system']);
  });

  it('intersects requested with readable', () => {
    const grants: SegmentGrant[] = [
      { segment: 'food', access: 'read' },
      { segment: 'fun', access: 'write' },
    ];
    expect(allowedSegments(grants, ['food', 'financial'])).toEqual(['food']);
  });

  it('returns empty when no overlap', () => {
    const grants: SegmentGrant[] = [{ segment: 'food', access: 'read' }];
    expect(allowedSegments(grants, ['financial'])).toEqual([]);
  });
});

describe('listEvents filter composition', () => {
  it('applies household, window, order, and limit', async () => {
    const { client, captured } = makeFakeClient([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await listEvents(baseArgs(), { client: client as any });

    expect(captured.schema).toBe('app');
    expect(captured.table).toBe('event');
    expect(captured.filters).toContainEqual({ op: 'eq', column: 'household_id', value: HOUSEHOLD });
    expect(captured.filters).toContainEqual({ op: 'lt', column: 'starts_at', value: TO });

    const orFilter = captured.filters.find((f) => f.op === 'or');
    expect(orFilter).toBeDefined();
    expect(String(orFilter?.value)).toContain(`ends_at.gt.${FROM}`);
    expect(String(orFilter?.value)).toContain(`and(ends_at.is.null,starts_at.gte.${FROM})`);

    expect(captured.order).toEqual({ column: 'starts_at', ascending: true });
    expect(captured.limit).toBe(500);
  });

  it('includes segments filter when provided', async () => {
    const { client, captured } = makeFakeClient([]);
    await listEvents(
      { ...baseArgs(), segments: ['food', 'fun'] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { client: client as any },
    );
    const inFilter = captured.filters.find((f) => f.op === 'in');
    expect(inFilter).toEqual({ op: 'in', column: 'segment', value: ['food', 'fun'] });
  });

  it('intersects segments with grants', async () => {
    const { client, captured } = makeFakeClient([]);
    await listEvents(
      { ...baseArgs(), segments: ['financial', 'food', 'fun'] },
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client: client as any,
        grants: [
          { segment: 'financial', access: 'none' },
          { segment: 'food', access: 'read' },
          { segment: 'fun', access: 'write' },
        ],
      },
    );
    const inFilter = captured.filters.find((f) => f.op === 'in');
    expect(inFilter?.value).toEqual(['food', 'fun']);
  });

  it('returns empty without a query when grants remove all segments', async () => {
    const { client, captured } = makeFakeClient([]);
    const result = await listEvents(
      { ...baseArgs(), segments: ['financial'] },
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client: client as any,
        grants: [{ segment: 'food', access: 'read' }],
      },
    );
    expect(result).toEqual([]);
    // No filters should have been applied — the table was never opened.
    expect(captured.filters).toHaveLength(0);
  });

  it('returns empty when window is degenerate', async () => {
    const { client, captured } = makeFakeClient([]);
    const result = await listEvents(
      { householdId: HOUSEHOLD, from: TO, to: FROM },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { client: client as any },
    );
    expect(result).toEqual([]);
    expect(captured.filters).toHaveLength(0);
  });
});

describe('listEvents row mapping', () => {
  it('maps snake_case rows to camelCase with normalized metadata', async () => {
    const row: FakeRow = {
      id: 'e1',
      household_id: HOUSEHOLD,
      owner_member_id: 'm1',
      segment: 'food',
      kind: 'gcal_event',
      title: 'Dinner',
      starts_at: '2026-04-21T18:00:00.000Z',
      ends_at: '2026-04-21T19:00:00.000Z',
      all_day: false,
      location: 'Kitchen',
      provider: 'gcal',
      metadata: { notes: 'bring wine' },
    };
    const { client } = makeFakeClient([row]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await listEvents(baseArgs(), { client: client as any });
    expect(result).toEqual([
      {
        id: 'e1',
        householdId: HOUSEHOLD,
        ownerMemberId: 'm1',
        segment: 'food',
        kind: 'gcal_event',
        title: 'Dinner',
        startsAt: '2026-04-21T18:00:00.000Z',
        endsAt: '2026-04-21T19:00:00.000Z',
        allDay: false,
        location: 'Kitchen',
        provider: 'gcal',
        metadata: { notes: 'bring wine' },
      },
    ]);
  });

  it('falls back to an empty object for non-object metadata', async () => {
    const row: FakeRow = {
      id: 'e1',
      household_id: HOUSEHOLD,
      owner_member_id: null,
      segment: 'system',
      kind: 'birthday',
      title: 'Alex birthday',
      starts_at: '2026-04-21T00:00:00.000Z',
      ends_at: null,
      all_day: true,
      location: null,
      provider: null,
      metadata: null,
    };
    const { client } = makeFakeClient([row]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await listEvents(baseArgs(), { client: client as any });
    expect(result[0]?.metadata).toEqual({});
    expect(result[0]?.endsAt).toBeNull();
    expect(result[0]?.allDay).toBe(true);
  });
});
