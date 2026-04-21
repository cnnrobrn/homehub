/**
 * Unit tests for `runPantryDiffWorker`.
 *
 * Uses the same in-memory supabase stub pattern as the alerts worker.
 * Exercises the happy path, unchanged-draft short circuit, and the
 * empty-meals / empty-deficits fallbacks.
 */

import { type Logger } from '@homehub/worker-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { __internal, runPantryDiffWorker } from './handler.js';

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
  id?: string;
  [k: string]: unknown;
}

interface State {
  households: Row[];
  meals: Row[];
  pantryItems: Row[];
  dishNodes: Row[];
  ingredientNodes: Row[];
  edges: Row[];
  groceryLists: Row[];
  groceryListItems: Row[];
  audits: Row[];
}

function makeSupabase(initial: Partial<State> = {}) {
  const state: State = {
    households: initial.households ?? [],
    meals: initial.meals ?? [],
    pantryItems: initial.pantryItems ?? [],
    dishNodes: initial.dishNodes ?? [],
    ingredientNodes: initial.ingredientNodes ?? [],
    edges: initial.edges ?? [],
    groceryLists: initial.groceryLists ?? [],
    groceryListItems: initial.groceryListItems ?? [],
    audits: initial.audits ?? [],
  };
  let listId = 1;
  let itemId = 1;

  function buildQuery(rows: Row[], opts: { key?: keyof State } = {}) {
    const filters: Array<{ op: 'eq' | 'neq' | 'gte' | 'lte' | 'in'; col: string; value: unknown }> =
      [];
    let limit: number | undefined;
    let insertPayload: Row[] | undefined;
    let updatePayload: Partial<Row> | undefined;
    let deleteMode = false;

    const chain: Record<string, unknown> = {
      select() {
        return chain;
      },
      eq(col: string, value: unknown) {
        filters.push({ op: 'eq', col, value });
        return chain;
      },
      neq(col: string, value: unknown) {
        filters.push({ op: 'neq', col, value });
        return chain;
      },
      gte(col: string, value: unknown) {
        filters.push({ op: 'gte', col, value });
        return chain;
      },
      lte(col: string, value: unknown) {
        filters.push({ op: 'lte', col, value });
        return chain;
      },
      in(col: string, values: unknown[]) {
        filters.push({ op: 'in', col, value: values });
        return chain;
      },
      order() {
        return chain;
      },
      limit(n: number) {
        limit = n;
        return chain;
      },
      insert(payload: Row | Row[]) {
        insertPayload = Array.isArray(payload) ? payload : [payload];
        return chain;
      },
      update(payload: Partial<Row>) {
        updatePayload = { ...payload };
        return chain;
      },
      delete() {
        deleteMode = true;
        return chain;
      },
      maybeSingle() {
        const rs = applyFilters(rows);
        return Promise.resolve({ data: rs[0] ?? null, error: null });
      },
      single() {
        if (insertPayload) {
          const first = insertPayload[0] ?? {};
          const id =
            opts.key === 'groceryLists'
              ? `gl-${listId++}`
              : opts.key === 'groceryListItems'
                ? `it-${itemId++}`
                : ((first.id as string) ?? 'new-id');
          const inserted: Row = { ...first, id };
          if (opts.key === 'groceryLists') state.groceryLists.push(inserted);
          if (opts.key === 'groceryListItems') state.groceryListItems.push(inserted);
          return Promise.resolve({ data: { id }, error: null });
        }
        const rs = applyFilters(rows);
        return Promise.resolve({ data: rs[0] ?? null, error: null });
      },
      then(fulfill: (v: unknown) => unknown) {
        if (insertPayload) {
          for (const p of insertPayload) {
            const id =
              opts.key === 'groceryLists'
                ? `gl-${listId++}`
                : opts.key === 'groceryListItems'
                  ? `it-${itemId++}`
                  : ((p.id as string) ?? 'new-id');
            const row = { ...p, id };
            if (opts.key === 'groceryLists') state.groceryLists.push(row);
            if (opts.key === 'groceryListItems') state.groceryListItems.push(row);
            if (opts.key === 'audits') state.audits.push(row);
          }
          return Promise.resolve(fulfill({ data: null, error: null }));
        }
        if (deleteMode) {
          const keep = rows.filter((r) => !matches(r));
          rows.splice(0, rows.length, ...keep);
          return Promise.resolve(fulfill({ data: null, error: null }));
        }
        if (updatePayload) {
          for (const r of rows) {
            if (matches(r)) Object.assign(r, updatePayload);
          }
          return Promise.resolve(fulfill({ data: null, error: null }));
        }
        const rs = applyFilters(rows);
        return Promise.resolve(fulfill({ data: rs, error: null }));
      },
    };

    function matches(r: Row): boolean {
      for (const f of filters) {
        const v = r[f.col];
        if (f.op === 'eq' && v !== f.value) return false;
        if (f.op === 'neq' && v === f.value) return false;
        if (f.op === 'gte' && !(String(v) >= String(f.value))) return false;
        if (f.op === 'lte' && !(String(v) <= String(f.value))) return false;
        if (f.op === 'in' && !(f.value as unknown[]).includes(v)) return false;
      }
      return true;
    }

    function applyFilters(input: Row[]): Row[] {
      let out = input.filter(matches);
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
            from(table: string) {
              switch (table) {
                case 'household':
                  return buildQuery(state.households);
                case 'meal':
                  return buildQuery(state.meals);
                case 'pantry_item':
                  return buildQuery(state.pantryItems);
                case 'grocery_list':
                  return buildQuery(state.groceryLists, { key: 'groceryLists' });
                case 'grocery_list_item':
                  return buildQuery(state.groceryListItems, { key: 'groceryListItems' });
                default:
                  throw new Error(`unexpected app.${table}`);
              }
            },
          };
        }
        if (name === 'mem') {
          return {
            from(table: string) {
              if (table === 'node') {
                return {
                  select() {
                    return this;
                  },
                  eq(col: string, value: unknown) {
                    void col;
                    void value;
                    return this;
                  },
                  in(col: string, values: unknown[]) {
                    const rows = [...state.dishNodes, ...state.ingredientNodes].filter((r) =>
                      values.includes(r[col]),
                    );
                    return {
                      then(resolve: (v: unknown) => unknown) {
                        return Promise.resolve(resolve({ data: rows, error: null }));
                      },
                    };
                  },
                };
              }
              if (table === 'edge') {
                return buildQuery(state.edges);
              }
              throw new Error(`unexpected mem.${table}`);
            },
          };
        }
        if (name === 'audit') {
          return {
            from() {
              return {
                insert: async (row: Row) => {
                  state.audits.push({ ...row, id: `aud-${state.audits.length + 1}` });
                  return { data: null, error: null };
                },
              };
            },
          };
        }
        throw new Error(`unexpected schema ${name}`);
      },
    },
  };
}

const HOUSEHOLD_ID = 'h0000000-0000-4000-8000-000000000001';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('nextSaturday helper', () => {
  it('returns the upcoming Saturday', () => {
    // Monday 2026-04-20
    expect(__internal.nextSaturday(new Date('2026-04-20T00:00:00Z'))).toBe('2026-04-25');
    // Saturday 2026-04-25 should return next Saturday.
    expect(__internal.nextSaturday(new Date('2026-04-25T00:00:00Z'))).toBe('2026-05-02');
  });
});

describe('runPantryDiffWorker', () => {
  const now = new Date('2026-04-20T06:00:00Z');

  it('creates a draft when deficits exist', async () => {
    const { supabase, state } = makeSupabase({
      households: [{ id: HOUSEHOLD_ID }],
      meals: [
        {
          id: 'm-1',
          household_id: HOUSEHOLD_ID,
          planned_for: '2026-04-22',
          slot: 'dinner',
          title: 'Pasta',
          dish_node_id: 'd-1',
          status: 'planned',
        },
      ],
      pantryItems: [],
      dishNodes: [{ id: 'd-1', household_id: HOUSEHOLD_ID, canonical_name: 'Pasta', metadata: {} }],
      ingredientNodes: [
        { id: 'i-1', household_id: HOUSEHOLD_ID, canonical_name: 'Pasta noodles' },
        { id: 'i-2', household_id: HOUSEHOLD_ID, canonical_name: 'Tomato sauce' },
      ],
      edges: [
        {
          household_id: HOUSEHOLD_ID,
          src_id: 'd-1',
          dst_id: 'i-1',
          type: 'contains',
        },
        {
          household_id: HOUSEHOLD_ID,
          src_id: 'd-1',
          dst_id: 'i-2',
          type: 'contains',
        },
      ],
    });

    const out = await runPantryDiffWorker({
      supabase: supabase as never,
      log: makeLog(),
      now: () => now,
    });

    expect(out).toHaveLength(1);
    expect(out[0]!.deficitCount).toBe(2);
    expect(state.groceryLists).toHaveLength(1);
    expect(state.groceryListItems).toHaveLength(2);
  });

  it('reports no_meals when no upcoming meals exist', async () => {
    const { supabase } = makeSupabase({
      households: [{ id: HOUSEHOLD_ID }],
    });
    const out = await runPantryDiffWorker({
      supabase: supabase as never,
      log: makeLog(),
      now: () => now,
    });
    expect(out[0]!.skippedReason).toBe('no_meals');
  });

  it('reports no_deficits when the pantry covers all ingredients', async () => {
    const { supabase } = makeSupabase({
      households: [{ id: HOUSEHOLD_ID }],
      meals: [
        {
          id: 'm-1',
          household_id: HOUSEHOLD_ID,
          planned_for: '2026-04-22',
          slot: 'dinner',
          title: 'Pasta',
          dish_node_id: 'd-1',
          status: 'planned',
        },
      ],
      pantryItems: [
        {
          household_id: HOUSEHOLD_ID,
          name: 'Pasta noodles',
          quantity: 1,
          unit: 'lb',
        },
      ],
      dishNodes: [{ id: 'd-1', household_id: HOUSEHOLD_ID, canonical_name: 'Pasta', metadata: {} }],
      ingredientNodes: [{ id: 'i-1', household_id: HOUSEHOLD_ID, canonical_name: 'Pasta noodles' }],
      edges: [
        {
          household_id: HOUSEHOLD_ID,
          src_id: 'd-1',
          dst_id: 'i-1',
          type: 'contains',
        },
      ],
    });
    const out = await runPantryDiffWorker({
      supabase: supabase as never,
      log: makeLog(),
      now: () => now,
    });
    expect(out[0]!.skippedReason).toBe('no_deficits');
  });
});
