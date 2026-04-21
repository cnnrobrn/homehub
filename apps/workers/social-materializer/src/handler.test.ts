/**
 * Unit tests for the social materializer.
 *
 * Strategy: in-memory supabase stub with the minimum surface the
 * handler uses (app.household, mem.fact, mem.node, app.event,
 * audit.event). Fixtures cover:
 *   - First-time materialization for a birthday fact.
 *   - Idempotent re-run: second invocation does not duplicate.
 *   - Supersession: fact value changes → old event marked stale, new
 *     event inserted.
 *   - Leap-day fallback.
 */

import { type Logger } from '@homehub/worker-runtime';
import { describe, expect, it } from 'vitest';

import { nextOccurrenceUtc, parseMonthDay, runSocialMaterializer } from './handler.js';

function makeLog(): Logger {
  const noop = () => {};
  const base = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => base,
  } as Logger;
  return base;
}

interface Row {
  id: string;
  [k: string]: unknown;
}

interface State {
  households: Row[];
  facts: Row[];
  nodes: Row[];
  events: Row[];
  audits: Row[];
}

function makeSupabase(initial: Partial<State> = {}) {
  const state: State = {
    households: initial.households ?? [],
    facts: initial.facts ?? [],
    nodes: initial.nodes ?? [],
    events: initial.events ?? [],
    audits: initial.audits ?? [],
  };
  let nextEventId = 1;

  function buildQuery(table: keyof State) {
    const rows = () => state[table] as Row[];
    const filters: Record<string, unknown> = {};
    const inFilters: Record<string, unknown[]> = {};
    const isNullCols: string[] = [];
    let limit: number | undefined;
    let insertPayload: Row | undefined;
    let updatePayload: Partial<Row> | undefined;
    let selectHead = false;

    const chain: Record<string, unknown> = {
      select(_cols?: string, o?: { count?: string; head?: boolean }) {
        if (o?.head) selectHead = true;
        return chain;
      },
      eq(col: string, val: unknown) {
        filters[col] = val;
        return chain;
      },
      in(col: string, vals: unknown[]) {
        inFilters[col] = vals;
        return chain;
      },
      is(col: string, val: unknown) {
        if (val === null) isNullCols.push(col);
        return chain;
      },
      limit(n: number) {
        limit = n;
        return chain;
      },
      insert(payload: Row | Row[]) {
        insertPayload = Array.isArray(payload) ? payload[0]! : payload;
        return chain;
      },
      update(payload: Partial<Row>) {
        updatePayload = { ...payload };
        return chain;
      },
      maybeSingle() {
        const result = apply();
        return Promise.resolve({ data: result[0] ?? null, error: null });
      },
      single() {
        if (insertPayload) {
          const id = `ev-${nextEventId++}`;
          const row = { ...insertPayload, id };
          (state[table] as Row[]).push(row);
          return Promise.resolve({ data: { id }, error: null });
        }
        const result = apply();
        return Promise.resolve({ data: result[0] ?? null, error: null });
      },
      then(fulfill: (v: unknown) => unknown) {
        if (insertPayload) {
          const id = `ev-${nextEventId++}`;
          const row = { ...insertPayload, id };
          (state[table] as Row[]).push(row);
          return Promise.resolve(fulfill({ data: null, error: null }));
        }
        if (updatePayload) {
          const id = filters['id'] as string;
          const arr = state[table] as Row[];
          const idx = arr.findIndex((r) => r.id === id);
          if (idx >= 0) {
            arr[idx] = { ...arr[idx]!, ...updatePayload };
          }
          return Promise.resolve(fulfill({ data: null, error: null }));
        }
        const result = apply();
        if (selectHead)
          return Promise.resolve(fulfill({ data: null, error: null, count: result.length }));
        return Promise.resolve(fulfill({ data: result, error: null }));
      },
    };

    function apply(): Row[] {
      let out = rows().slice();
      for (const [k, v] of Object.entries(filters)) out = out.filter((r) => r[k] === v);
      for (const [k, vs] of Object.entries(inFilters)) out = out.filter((r) => vs.includes(r[k]));
      for (const col of isNullCols)
        out = out.filter((r) => r[col] === null || r[col] === undefined);
      if (limit != null) out = out.slice(0, limit);
      return out;
    }

    return chain;
  }

  return {
    state,
    supabase: {
      schema(name: string) {
        if (name === 'app') {
          return {
            from: (t: string) => {
              if (t === 'household') return buildQuery('households');
              if (t === 'event') return buildQuery('events');
              throw new Error(`unexpected app.${t}`);
            },
          };
        }
        if (name === 'mem') {
          return {
            from: (t: string) => {
              if (t === 'fact') return buildQuery('facts');
              if (t === 'node') return buildQuery('nodes');
              throw new Error(`unexpected mem.${t}`);
            },
          };
        }
        if (name === 'audit') {
          return {
            from: () => ({
              insert: async (row: Row) => {
                state.audits.push({ ...row, id: `aud-${state.audits.length + 1}` });
                return { data: null, error: null };
              },
            }),
          };
        }
        throw new Error(`unexpected schema ${name}`);
      },
    },
  };
}

const HOUSEHOLD = 'h-1';
const PERSON = 'person-1';

function bdayFact(objectValue: unknown, id = 'fact-1'): Row {
  return {
    id,
    household_id: HOUSEHOLD,
    subject_node_id: PERSON,
    predicate: 'has_birthday',
    object_value: objectValue,
    object_node_id: null,
    confidence: 0.95,
    evidence: [],
    valid_from: '2025-01-01T00:00:00Z',
    valid_to: null,
    recorded_at: '2025-01-01T00:00:00Z',
    superseded_at: null,
    superseded_by: null,
    source: 'member',
    reinforcement_count: 1,
    last_reinforced_at: '2025-01-01T00:00:00Z',
    conflict_status: 'none',
  };
}

function personNode(): Row {
  return {
    id: PERSON,
    household_id: HOUSEHOLD,
    type: 'person',
    canonical_name: 'Priya',
    metadata: {},
    needs_review: false,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  };
}

describe('runSocialMaterializer', () => {
  const now = new Date('2026-04-20T00:00:00Z');

  it('first run materializes a birthday event', async () => {
    const { supabase, state } = makeSupabase({
      households: [{ id: HOUSEHOLD }],
      facts: [bdayFact('1990-04-25')],
      nodes: [personNode()],
    });
    const results = await runSocialMaterializer({
      supabase: supabase as never,
      log: makeLog(),
      now: () => now,
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.eventsInserted).toBe(1);
    expect(state.events).toHaveLength(1);
    const ev = state.events[0]!;
    expect(ev.segment).toBe('social');
    expect(ev.kind).toBe('birthday');
    expect(ev.starts_at).toBe('2026-04-25T00:00:00.000Z');
    expect(ev.all_day).toBe(true);
    expect(ev.title).toBe("Priya's birthday");
    const meta = ev.metadata as Record<string, unknown>;
    expect(meta.subject_node_id).toBe(PERSON);
    expect(meta.predicate).toBe('has_birthday');
    expect(state.audits).toHaveLength(1);
  });

  it('second run is idempotent — no duplicate insert', async () => {
    const { supabase, state } = makeSupabase({
      households: [{ id: HOUSEHOLD }],
      facts: [bdayFact('1990-04-25')],
      nodes: [personNode()],
    });
    await runSocialMaterializer({ supabase: supabase as never, log: makeLog(), now: () => now });
    expect(state.events).toHaveLength(1);
    const second = await runSocialMaterializer({
      supabase: supabase as never,
      log: makeLog(),
      now: () => now,
    });
    expect(second[0]!.eventsInserted).toBe(0);
    expect(second[0]!.eventsReused).toBe(1);
    expect(state.events).toHaveLength(1);
  });

  it('supersession: fact changes → old event marked stale + new inserted', async () => {
    const { supabase, state } = makeSupabase({
      households: [{ id: HOUSEHOLD }],
      facts: [bdayFact('1990-04-25')],
      nodes: [personNode()],
    });
    await runSocialMaterializer({ supabase: supabase as never, log: makeLog(), now: () => now });
    // Now simulate supersession: the old fact gets superseded_at set
    // (not shown to the materializer), and a new fact is written.
    state.facts[0]!.valid_to = '2026-04-19T00:00:00Z';
    state.facts[0]!.superseded_at = '2026-04-19T00:00:00Z';
    state.facts.push(bdayFact('1990-05-10', 'fact-2'));
    const second = await runSocialMaterializer({
      supabase: supabase as never,
      log: makeLog(),
      now: () => now,
    });
    expect(second[0]!.eventsInserted).toBe(1);
    expect(second[0]!.staleMarked).toBe(1);
    const stale = state.events.find((e) => e.starts_at === '2026-04-25T00:00:00.000Z');
    const fresh = state.events.find((e) => e.starts_at === '2026-05-10T00:00:00.000Z');
    expect(stale).toBeTruthy();
    expect(fresh).toBeTruthy();
    expect((stale!.metadata as Record<string, unknown>).stale).toBe(true);
  });

  it('handles leap-day birthdays by falling back to Feb 28 in non-leap years', () => {
    const result = nextOccurrenceUtc(2, 29, new Date('2026-01-01T00:00:00Z'));
    expect(result).toBe('2026-02-28T00:00:00.000Z');
    const resultLeap = nextOccurrenceUtc(2, 29, new Date('2028-01-01T00:00:00Z'));
    expect(resultLeap).toBe('2028-02-29T00:00:00.000Z');
  });

  it('advances to the next year when the day has already passed', () => {
    const result = nextOccurrenceUtc(3, 5, new Date('2026-04-20T00:00:00Z'));
    expect(result).toBe('2027-03-05T00:00:00.000Z');
  });
});

describe('parseMonthDay', () => {
  it('accepts YYYY-MM-DD strings', () => {
    expect(parseMonthDay('1990-04-25')).toEqual({ month: 4, day: 25 });
  });
  it('accepts MM-DD strings', () => {
    expect(parseMonthDay('04-25')).toEqual({ month: 4, day: 25 });
  });
  it('accepts {month, day} objects', () => {
    expect(parseMonthDay({ month: 4, day: 25 })).toEqual({ month: 4, day: 25 });
  });
  it('rejects invalid month/day', () => {
    expect(parseMonthDay('13-99')).toBeNull();
    expect(parseMonthDay('not-a-date')).toBeNull();
    expect(parseMonthDay(null)).toBeNull();
  });
});
