import {
  ACTION_SUGGESTION_HASH_KEY,
  canonicalHash,
  type SuggestionRow,
  type ActionRow,
} from '@homehub/approval-flow';
import { beforeEach, describe, expect, it } from 'vitest';

import { classifyError, processOne } from './execute-handler.js';
import {
  __clearRegistryForTests,
  registerExecutor,
  OrphanActionError,
  TamperDetectedError,
  UnknownActionKindError,
} from './registry.js';

// ---------------------------------------------------------------------------
// Minimal in-memory Supabase fake (same shape as the approval-flow tests).
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function makeFakeSupabase(
  initial: {
    suggestions?: Row[];
    actions?: Row[];
  } = {},
) {
  const db = {
    app: {
      suggestion: [...(initial.suggestions ?? [])] as Row[],
      action: [...(initial.actions ?? [])] as Row[],
      household: [] as Row[],
    },
    audit: {
      event: [] as Row[],
    },
  };

  interface QueryState {
    schema: 'app' | 'audit';
    table: string;
    filters: Array<{ col: string; val: unknown }>;
    mode: 'select' | 'update' | 'insert';
    payload?: Row;
    inserts?: Row[];
  }

  function applyFilters(rows: Row[], filters: QueryState['filters']): Row[] {
    return rows.filter((r) => filters.every((f) => r[f.col] === f.val));
  }

  function exec(state: QueryState): { data: unknown; error: { message: string } | null } {
    const tableRows =
      state.schema === 'app'
        ? (db.app as unknown as Record<string, Row[]>)[state.table]
        : (db.audit as unknown as Record<string, Row[]>)[state.table];
    if (!tableRows) {
      return { data: null, error: { message: `unknown table ${state.table}` } };
    }
    if (state.mode === 'insert') {
      const withIds = (state.inserts ?? []).map((r) => ({
        id:
          typeof r.id === 'string' ? r.id : `generated-${Math.random().toString(36).slice(2, 10)}`,
        ...r,
      }));
      tableRows.push(...withIds);
      return { data: withIds.length === 1 ? withIds[0] : withIds, error: null };
    }
    if (state.mode === 'update') {
      const matched = applyFilters(tableRows, state.filters);
      for (const row of matched) Object.assign(row, state.payload ?? {});
      if (matched.length === 0) return { data: null, error: null };
      return { data: matched.length === 1 ? matched[0] : matched, error: null };
    }
    const rows = applyFilters(tableRows, state.filters);
    return { data: rows.length === 1 ? rows[0] : rows.length > 1 ? rows : null, error: null };
  }

  function buildThenable(state: QueryState) {
    return {
      then(resolve: (v: { data: unknown; error: { message: string } | null }) => unknown) {
        return Promise.resolve(exec(state)).then(resolve);
      },
      eq(col: string, val: unknown) {
        state.filters.push({ col, val });
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
  }

  const supabase = {
    schema(name: 'app' | 'audit') {
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
          };
        },
      };
    },
  };

  return { supabase: supabase as never, db };
}

// ---------------------------------------------------------------------------

function silentLog() {
  const noop = () => undefined;
  return {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child() {
      return silentLog();
    },
  };
}

function makeSuggestion(overrides: Partial<SuggestionRow> = {}): SuggestionRow {
  return {
    id: 's1',
    household_id: 'h1',
    segment: 'fun',
    kind: 'outing_idea',
    title: 'Trip',
    rationale: 'r',
    preview: { place: 'park' },
    status: 'approved',
    created_at: '2025-01-01T00:00:00Z',
    resolved_at: '2025-02-01T00:00:00Z',
    resolved_by: 'm1',
    ...overrides,
  };
}

function makeAction(overrides: Partial<ActionRow> = {}): ActionRow {
  const suggestion = { kind: 'outing_idea', household_id: 'h1', preview: { place: 'park' } };
  return {
    id: 'a1',
    household_id: 'h1',
    suggestion_id: 's1',
    segment: 'fun',
    kind: 'outing_idea',
    payload: { [ACTION_SUGGESTION_HASH_KEY]: canonicalHash(suggestion) },
    status: 'pending',
    started_at: null,
    finished_at: null,
    error: null,
    result: null,
    created_by: 'm1',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe('processOne (execute handler)', () => {
  beforeEach(() => {
    __clearRegistryForTests();
  });

  it('executes a registered handler and transitions succeeded', async () => {
    const { supabase, db } = makeFakeSupabase({
      suggestions: [makeSuggestion() as unknown as Row],
      actions: [makeAction() as unknown as Row],
    });
    registerExecutor('outing_idea', async () => ({ result: { external_id: 'ext-1' } }));
    await processOne({ supabase, log: silentLog() }, 'a1');

    const action = db.app.action[0]!;
    expect(action.status).toBe('succeeded');
    expect(action.started_at).toBeDefined();
    expect(action.finished_at).toBeDefined();
    expect(action.result).toEqual({ external_id: 'ext-1' });

    const suggestion = db.app.suggestion[0]!;
    expect(suggestion.status).toBe('executed');

    // Expect at least action.started + action.succeeded audits.
    const actions = db.audit.event.map((e) => e.action);
    expect(actions).toContain('action.started');
    expect(actions).toContain('action.succeeded');
  });

  it('fails action and throws TamperDetectedError when hash mismatches', async () => {
    const { supabase, db } = makeFakeSupabase({
      suggestions: [makeSuggestion({ preview: { place: 'somewhere_else' } }) as unknown as Row],
      actions: [makeAction() as unknown as Row],
    });
    registerExecutor('outing_idea', async () => ({ result: {} }));

    await expect(processOne({ supabase, log: silentLog() }, 'a1')).rejects.toBeInstanceOf(
      TamperDetectedError,
    );
    expect(db.app.action[0]!.status).toBe('failed');
    expect(db.app.action[0]!.error).toContain('suggestion_hash');
  });

  it('fails action when stored suggestion_hash is missing', async () => {
    const { supabase, db } = makeFakeSupabase({
      suggestions: [makeSuggestion() as unknown as Row],
      actions: [makeAction({ payload: {} }) as unknown as Row],
    });
    registerExecutor('outing_idea', async () => ({ result: {} }));

    await expect(processOne({ supabase, log: silentLog() }, 'a1')).rejects.toBeInstanceOf(
      TamperDetectedError,
    );
    expect(db.app.action[0]!.status).toBe('failed');
  });

  it('throws UnknownActionKindError when no executor is registered', async () => {
    const { supabase, db } = makeFakeSupabase({
      suggestions: [makeSuggestion() as unknown as Row],
      actions: [makeAction() as unknown as Row],
    });
    // Registry is empty.
    await expect(processOne({ supabase, log: silentLog() }, 'a1')).rejects.toBeInstanceOf(
      UnknownActionKindError,
    );
    expect(db.app.action[0]!.status).toBe('failed');
  });

  it('propagates executor errors as failed transitions', async () => {
    const { supabase, db } = makeFakeSupabase({
      suggestions: [makeSuggestion() as unknown as Row],
      actions: [makeAction() as unknown as Row],
    });
    registerExecutor('outing_idea', async () => {
      throw new Error('provider down');
    });
    await expect(processOne({ supabase, log: silentLog() }, 'a1')).rejects.toThrow('provider down');
    expect(db.app.action[0]!.status).toBe('failed');
    expect(db.app.action[0]!.error).toBe('provider down');
  });

  it('is idempotent on a re-claimed succeeded action', async () => {
    const { supabase, db } = makeFakeSupabase({
      suggestions: [makeSuggestion() as unknown as Row],
      actions: [makeAction({ status: 'succeeded', result: { ok: true } }) as unknown as Row],
    });
    await processOne({ supabase, log: silentLog() }, 'a1');
    expect(db.app.action[0]!.status).toBe('succeeded');
    // No extra audit rows on idempotent short-circuit.
    expect(db.audit.event).toHaveLength(0);
  });

  it('throws OrphanActionError when suggestion_id is missing', async () => {
    const { supabase } = makeFakeSupabase({
      actions: [makeAction({ suggestion_id: null }) as unknown as Row],
    });
    await expect(processOne({ supabase, log: silentLog() }, 'a1')).rejects.toBeInstanceOf(
      OrphanActionError,
    );
  });
});

describe('classifyError', () => {
  it('marks UnknownActionKindError terminal', () => {
    const res = classifyError(new UnknownActionKindError('foo'));
    expect(res.terminal).toBe(true);
  });

  it('marks TamperDetectedError terminal', () => {
    const res = classifyError(new TamperDetectedError('bad'));
    expect(res.terminal).toBe(true);
  });

  it('marks OrphanActionError terminal', () => {
    const res = classifyError(new OrphanActionError('a1'));
    expect(res.terminal).toBe(true);
  });

  it('marks unknown errors as transient', () => {
    const res = classifyError(new Error('network fail'));
    expect(res.terminal).toBe(false);
    expect(res.retryDelaySec).toBe(60);
  });
});
