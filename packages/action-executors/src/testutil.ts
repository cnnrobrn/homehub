/**
 * Test utilities for action-executor unit tests. Not part of the
 * public surface (not re-exported from `index.ts`); each `.test.ts`
 * imports from this file directly.
 *
 * The fake Supabase client mirrors the shape in
 * `apps/workers/action-executor/src/execute-handler.test.ts`: a
 * thenable query builder backed by in-memory row arrays keyed by
 * schema + table. Sufficient for select/insert/update/upsert with
 * `.eq`, `.in`, `.is`, `.select`, `.single`, `.maybeSingle`, `.limit`.
 */

import { type ActionRow, type SuggestionRow } from '@homehub/approval-flow';
import { type Logger } from '@homehub/worker-runtime';

import { type ActionExecutor } from './types.js';

// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type SchemaName = string;

export interface FakeDb {
  [schema: string]: {
    [table: string]: Row[];
  };
}

export function silentLog(): Logger {
  const noop = () => undefined;
  const l = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child() {
      return l;
    },
  } as unknown as Logger;
  return l;
}

interface QueryState {
  schema: SchemaName;
  table: string;
  filters: Array<{ op: 'eq' | 'in' | 'is'; col: string; val: unknown }>;
  mode: 'select' | 'update' | 'insert' | 'upsert';
  payload?: Row;
  inserts?: Row[];
  limitN?: number;
}

function matches(row: Row, filters: QueryState['filters']): boolean {
  return filters.every((f) => {
    if (f.op === 'eq') return row[f.col] === f.val;
    if (f.op === 'in') return Array.isArray(f.val) && (f.val as unknown[]).includes(row[f.col]);
    if (f.op === 'is') return row[f.col] === f.val;
    return false;
  });
}

function applyFilters(rows: Row[], filters: QueryState['filters']): Row[] {
  return rows.filter((r) => matches(r, filters));
}

/**
 * Construct a fake Supabase client backed by an in-memory `FakeDb`.
 * Operations: `.select`, `.insert`, `.update`, `.upsert`, `.eq`,
 * `.in`, `.is`, `.limit`, `.single`, `.maybeSingle`.
 *
 * The fake is *narrow*: it supports just enough PostgREST-shaped
 * syntax to cover the executor happy paths. If a test needs more, add
 * it here rather than stubbing ad-hoc in the test.
 */
export function makeFakeSupabase(initial: FakeDb = {}) {
  const db: FakeDb = {};
  for (const schema of Object.keys(initial)) {
    db[schema] = {};
    for (const table of Object.keys(initial[schema]!)) {
      db[schema]![table] = initial[schema]![table]!.map((r) => ({ ...r }));
    }
  }

  function tableRows(schema: SchemaName, table: string): Row[] {
    if (!db[schema]) db[schema] = {};
    if (!db[schema]![table]) db[schema]![table] = [];
    return db[schema]![table]!;
  }

  function exec(state: QueryState): { data: unknown; error: { message: string } | null } {
    const rows = tableRows(state.schema, state.table);

    if (state.mode === 'insert') {
      const withIds = (state.inserts ?? []).map((r) => ({
        id: typeof r.id === 'string' ? r.id : `gen-${Math.random().toString(36).slice(2, 10)}`,
        ...r,
      }));
      rows.push(...withIds);
      return { data: withIds.length === 1 ? withIds[0] : withIds, error: null };
    }
    if (state.mode === 'upsert') {
      const withIds = (state.inserts ?? []).map((r) => ({
        id: typeof r.id === 'string' ? r.id : `gen-${Math.random().toString(36).slice(2, 10)}`,
        ...r,
      }));
      for (const newRow of withIds) {
        const hit = rows.find((existing) => existing.id === newRow.id);
        if (hit) Object.assign(hit, newRow);
        else rows.push(newRow);
      }
      return { data: withIds.length === 1 ? withIds[0] : withIds, error: null };
    }
    if (state.mode === 'update') {
      const matched = applyFilters(rows, state.filters);
      for (const row of matched) Object.assign(row, state.payload ?? {});
      if (matched.length === 0) return { data: null, error: null };
      return { data: matched.length === 1 ? matched[0] : matched, error: null };
    }
    // select
    let out = applyFilters(rows, state.filters);
    if (state.limitN !== undefined) out = out.slice(0, state.limitN);
    if (out.length === 0) return { data: [], error: null };
    return { data: out, error: null };
  }

  function buildThenable(state: QueryState) {
    const t = {
      then(resolve: (v: { data: unknown; error: { message: string } | null }) => unknown) {
        return Promise.resolve(exec(state)).then(resolve);
      },
      eq(col: string, val: unknown) {
        state.filters.push({ op: 'eq', col, val });
        return buildThenable(state);
      },
      in(col: string, val: unknown[]) {
        state.filters.push({ op: 'in', col, val });
        return buildThenable(state);
      },
      is(col: string, val: unknown) {
        state.filters.push({ op: 'is', col, val });
        return buildThenable(state);
      },
      limit(n: number) {
        state.limitN = n;
        return buildThenable(state);
      },
      select() {
        return buildThenable(state);
      },
      maybeSingle: async () => {
        const { data, error } = exec(state);
        if (error) return { data: null, error };
        if (Array.isArray(data)) return { data: data[0] ?? null, error: null };
        return { data: data ?? null, error: null };
      },
      single: async () => {
        const { data, error } = exec(state);
        if (error) return { data: null, error };
        if (Array.isArray(data)) return { data: data[0] ?? null, error: null };
        return { data: data ?? null, error: null };
      },
    };
    return t;
  }

  const supabase = {
    schema(name: SchemaName) {
      return {
        from(table: string) {
          return {
            select() {
              return buildThenable({ schema: name, table, filters: [], mode: 'select' });
            },
            update(payload: Row) {
              return buildThenable({
                schema: name,
                table,
                filters: [],
                mode: 'update',
                payload,
              });
            },
            insert(payload: Row | Row[]) {
              return buildThenable({
                schema: name,
                table,
                filters: [],
                mode: 'insert',
                inserts: Array.isArray(payload) ? payload : [payload],
              });
            },
            upsert(payload: Row | Row[]) {
              return buildThenable({
                schema: name,
                table,
                filters: [],
                mode: 'upsert',
                inserts: Array.isArray(payload) ? payload : [payload],
              });
            },
          };
        },
      };
    },
  };

  return { supabase: supabase as never, db };
}

// ---------------------------------------------------------------------------

export function makeAction(overrides: Partial<ActionRow> = {}): ActionRow {
  return {
    id: 'a1',
    household_id: 'h1',
    suggestion_id: 's1',
    segment: 'fun',
    kind: 'outing_idea',
    payload: {},
    status: 'running',
    started_at: null,
    finished_at: null,
    error: null,
    result: null,
    created_by: null,
    created_at: '2026-04-20T00:00:00Z',
    updated_at: '2026-04-20T00:00:00Z',
    ...overrides,
  };
}

export function makeSuggestion(overrides: Partial<SuggestionRow> = {}): SuggestionRow {
  return {
    id: 's1',
    household_id: 'h1',
    segment: 'fun',
    kind: 'outing_idea',
    title: 'Outing',
    rationale: 'because',
    preview: {},
    status: 'approved',
    created_at: '2026-04-20T00:00:00Z',
    resolved_at: '2026-04-20T00:00:00Z',
    resolved_by: null,
    ...overrides,
  };
}

export async function runExecutor(
  executor: ActionExecutor,
  {
    action,
    suggestion,
    supabase,
  }: {
    action: ActionRow;
    suggestion: SuggestionRow;
    supabase: unknown;
  },
): ReturnType<ActionExecutor> {
  return executor({
    action,
    suggestion,
    supabase: supabase as never,
    log: silentLog(),
  });
}
