import { type SuggestionRow } from '@homehub/approval-flow';
import { describe, expect, it } from 'vitest';

import { processOne } from './evaluate-handler.js';

// ---------------------------------------------------------------------------
// Fake Supabase + fake queue client
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function makeFakeSupabase(
  initial: {
    suggestions?: Row[];
    actions?: Row[];
    households?: Row[];
  } = {},
) {
  const db = {
    app: {
      suggestion: [...(initial.suggestions ?? [])] as Row[],
      action: [...(initial.actions ?? [])] as Row[],
      household: [...(initial.households ?? [])] as Row[],
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

function makeFakeQueues() {
  const sent: Array<{ queue: string; payload: unknown }> = [];
  return {
    sent,
    queues: {
      async send(queue: string, payload: unknown) {
        sent.push({ queue, payload });
        return 1;
      },
      async sendBatch() {
        return [];
      },
      async claim() {
        return null;
      },
      async ack() {},
      async nack() {},
      async deadLetter() {},
      async depth() {
        return 0;
      },
      async ageOfOldestSec() {
        return null;
      },
    } as never,
  };
}

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
    status: 'pending',
    created_at: '2025-01-01T00:00:00Z',
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  };
}

describe('evaluate-handler processOne', () => {
  it('leaves pending when no auto-approval policy is set', async () => {
    const { supabase, db } = makeFakeSupabase({
      suggestions: [makeSuggestion() as unknown as Row],
      households: [{ id: 'h1', settings: {} } as Row],
    });
    const { queues, sent } = makeFakeQueues();
    const result = await processOne({ supabase, queues, log: silentLog() }, 's1');
    expect(result).toBe('left_pending');
    expect(db.app.suggestion[0]!.status).toBe('pending');
    expect(sent).toHaveLength(0);
  });

  it('auto-approves when household settings enable the kind', async () => {
    const { supabase, db } = makeFakeSupabase({
      suggestions: [makeSuggestion() as unknown as Row],
      households: [
        {
          id: 'h1',
          settings: { approval: { auto_approve_kinds: ['outing_idea'] } },
        } as Row,
      ],
    });
    const { queues, sent } = makeFakeQueues();
    const result = await processOne({ supabase, queues, log: silentLog() }, 's1');
    expect(result).toBe('auto_approved');
    const suggestion = db.app.suggestion[0]!;
    expect(suggestion.status).toBe('approved');
    // One action should have been dispatched → one execute_action message enqueued.
    expect(db.app.action).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.queue).toBe('execute_action');
  });

  it('never auto-approves destructive kinds even when listed in settings', async () => {
    const { supabase, db } = makeFakeSupabase({
      suggestions: [
        makeSuggestion({
          kind: 'cancel_subscription',
          segment: 'financial',
        }) as unknown as Row,
      ],
      households: [
        {
          id: 'h1',
          settings: { approval: { auto_approve_kinds: ['cancel_subscription'] } },
        } as Row,
      ],
    });
    const { queues, sent } = makeFakeQueues();
    const result = await processOne({ supabase, queues, log: silentLog() }, 's1');
    expect(result).toBe('left_pending');
    expect(db.app.suggestion[0]!.status).toBe('pending');
    expect(sent).toHaveLength(0);
  });

  it('no-ops when the suggestion is already non-pending', async () => {
    const { supabase, db } = makeFakeSupabase({
      suggestions: [makeSuggestion({ status: 'approved' }) as unknown as Row],
      households: [
        {
          id: 'h1',
          settings: { approval: { auto_approve_kinds: ['outing_idea'] } },
        } as Row,
      ],
    });
    const { queues } = makeFakeQueues();
    const result = await processOne({ supabase, queues, log: silentLog() }, 's1');
    expect(result).toBe('no_op');
    expect(db.app.suggestion[0]!.status).toBe('approved');
  });

  it('no-ops when the suggestion does not exist', async () => {
    const { supabase } = makeFakeSupabase({
      households: [{ id: 'h1', settings: {} } as Row],
    });
    const { queues } = makeFakeQueues();
    const result = await processOne({ supabase, queues, log: silentLog() }, 'missing');
    expect(result).toBe('no_op');
  });
});
