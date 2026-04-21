/**
 * Tests for the `list_events` tool adapter.
 *
 * We fake a Supabase chain that records every filter call and returns
 * seeded rows. We assert:
 *   1. `household_id` filter always comes from the auth context, never
 *      from client input.
 *   2. Window + segment filters compose correctly.
 *   3. Degenerate windows short-circuit without hitting the DB.
 *   4. Snake_case rows come back as camelCase.
 */

import { type ServiceSupabaseClient } from '@homehub/worker-runtime';
import { describe, expect, it } from 'vitest';

import { type AuthContext } from '../middleware/auth.js';

import { createListEventsTool } from './listEvents.js';

const HOUSEHOLD = 'a0000000-0000-4000-8000-000000000001';
const OTHER_HOUSEHOLD = 'b0000000-0000-4000-8000-000000000002';
const MEMBER = 'c0000000-0000-4000-8000-000000000010';

function memberCtx(): AuthContext {
  return {
    kind: 'member',
    householdId: HOUSEHOLD as AuthContext['householdId'],
    memberId: MEMBER as Extract<AuthContext, { kind: 'member' }>['memberId'],
    scopes: ['*'],
    tokenId: 'dev:test',
  };
}

interface CapturedCall {
  schema: string;
  table: string;
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
  source_id: string | null;
  source_version: string | null;
  created_at: string;
  updated_at: string;
}

function makeFakeSupabase(rows: FakeRow[] = []): {
  client: ServiceSupabaseClient;
  captured: CapturedCall;
} {
  const captured: CapturedCall = { schema: '', table: '', filters: [] };

  const q = {
    select(_cols: string) {
      return q;
    },
    eq(column: string, value: unknown) {
      captured.filters.push({ op: 'eq', column, value });
      return q;
    },
    lt(column: string, value: unknown) {
      captured.filters.push({ op: 'lt', column, value });
      return q;
    },
    gt(column: string, value: unknown) {
      captured.filters.push({ op: 'gt', column, value });
      return q;
    },
    or(expr: string) {
      captured.filters.push({ op: 'or', value: expr });
      return q;
    },
    in(column: string, value: unknown) {
      captured.filters.push({ op: 'in', column, value });
      return q;
    },
    order(column: string, opts: { ascending: boolean }) {
      captured.order = { column, ascending: opts.ascending };
      return q;
    },
    limit(n: number) {
      captured.limit = n;
      return q;
    },
    then(resolve: (v: { data: FakeRow[]; error: null }) => void) {
      resolve({ data: rows, error: null });
    },
  };

  const client = {
    schema(name: string) {
      captured.schema = name;
      return {
        from(table: string) {
          captured.table = table;
          return q;
        },
      };
    },
  } as unknown as ServiceSupabaseClient;
  return { client, captured };
}

const FROM = '2026-04-20T00:00:00.000Z';
const TO = '2026-04-27T00:00:00.000Z';

describe('createListEventsTool', () => {
  it('scopes to the auth-context household and applies window filters', async () => {
    const { client, captured } = makeFakeSupabase([]);
    const tool = createListEventsTool({ supabase: client });
    await tool.handler({ from: FROM, to: TO }, memberCtx());

    expect(captured.schema).toBe('app');
    expect(captured.table).toBe('event');
    expect(captured.filters).toContainEqual({
      op: 'eq',
      column: 'household_id',
      value: HOUSEHOLD,
    });
    expect(captured.filters).toContainEqual({ op: 'lt', column: 'starts_at', value: TO });
    const or = captured.filters.find((f) => f.op === 'or');
    expect(String(or?.value)).toContain(`ends_at.gt.${FROM}`);
    expect(captured.order).toEqual({ column: 'starts_at', ascending: true });
    expect(captured.limit).toBe(100);
  });

  it('ignores any client-supplied household_id — scoping comes from auth', async () => {
    const { client, captured } = makeFakeSupabase([]);
    const tool = createListEventsTool({ supabase: client });
    // Unknown properties are stripped by the zod schema; the handler
    // never sees a `householdId` input.
    await tool.handler(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { from: FROM, to: TO, householdId: OTHER_HOUSEHOLD } as any,
      memberCtx(),
    );
    const householdFilter = captured.filters.find(
      (f) => f.op === 'eq' && f.column === 'household_id',
    );
    expect(householdFilter?.value).toBe(HOUSEHOLD);
    expect(householdFilter?.value).not.toBe(OTHER_HOUSEHOLD);
  });

  it('applies the segments filter when provided', async () => {
    const { client, captured } = makeFakeSupabase([]);
    const tool = createListEventsTool({ supabase: client });
    await tool.handler({ from: FROM, to: TO, segments: ['food', 'fun'] }, memberCtx());
    expect(captured.filters).toContainEqual({
      op: 'in',
      column: 'segment',
      value: ['food', 'fun'],
    });
  });

  it('short-circuits to an empty list when the window is degenerate', async () => {
    const { client, captured } = makeFakeSupabase([]);
    const tool = createListEventsTool({ supabase: client });
    const res = await tool.handler({ from: TO, to: FROM }, memberCtx());
    expect(JSON.parse(res.content[0]?.text ?? '{}')).toEqual({ events: [] });
    expect(captured.filters).toHaveLength(0);
  });

  it('maps snake_case rows to the canonical CalendarEventRow', async () => {
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
      source_id: null,
      source_version: null,
      created_at: '2026-04-20T12:00:00.000Z',
      updated_at: '2026-04-20T12:00:00.000Z',
    };
    const { client } = makeFakeSupabase([row]);
    const tool = createListEventsTool({ supabase: client });
    const res = await tool.handler({ from: FROM, to: TO }, memberCtx());
    const parsed = JSON.parse(res.content[0]?.text ?? '{}') as { events: unknown[] };
    expect(parsed.events).toEqual([
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

  it('rejects malformed ISO input', async () => {
    const { client } = makeFakeSupabase([]);
    const tool = createListEventsTool({ supabase: client });
    await expect(tool.handler({ from: 'not-a-date', to: TO }, memberCtx())).rejects.toThrow();
  });
});
