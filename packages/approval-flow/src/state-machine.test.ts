import { beforeEach, describe, expect, it } from 'vitest';

import { ApprovalError } from './errors.js';
import {
  approveSuggestion,
  dispatchAction,
  extractApprovers,
  getApprovalState,
  rejectSuggestion,
  transitionAction,
  ACTION_SUGGESTION_HASH_KEY,
} from './state-machine.js';
import { type ActionRow, type SuggestionRow } from './types.js';

// ---------------------------------------------------------------------------
// In-memory fake Supabase client — narrow enough to exercise the state machine.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function makeFakeSupabase(
  initial: {
    suggestions?: Row[];
    actions?: Row[];
    failColumns?: Set<string>;
  } = {},
) {
  const db = {
    app: {
      suggestion: [...(initial.suggestions ?? [])] as Row[],
      action: [...(initial.actions ?? [])] as Row[],
    },
    audit: {
      event: [] as Row[],
    },
  };

  const failColumns = initial.failColumns ?? new Set<string>();

  interface QueryState {
    schema: 'app' | 'audit';
    table: string;
    filters: Array<{ col: string; val: unknown }>;
    mode: 'select' | 'update' | 'insert' | 'delete';
    payload?: Row;
    inserts?: Row[];
    selectColumns?: string;
  }

  function newQuery(schema: 'app' | 'audit', table: string): QueryState {
    return { schema, table, filters: [], mode: 'select' };
  }

  function applyFilters(rows: Row[], filters: QueryState['filters']): Row[] {
    return rows.filter((r) => filters.every((f) => r[f.col] === f.val));
  }

  function rejectUnknownColumns(payload: Row): { ok: boolean; message?: string } {
    for (const k of Object.keys(payload)) {
      if (failColumns.has(k)) {
        return {
          ok: false,
          message: `column "${k}" does not exist (PGRST204 schema cache)`,
        };
      }
    }
    return { ok: true };
  }

  function buildThenable(state: QueryState) {
    const exec = async (): Promise<{ data: unknown; error: { message: string } | null }> => {
      const tableRows =
        state.schema === 'app'
          ? (db.app as unknown as Record<string, Row[]>)[state.table]
          : (db.audit as unknown as Record<string, Row[]>)[state.table];
      if (!tableRows) return { data: null, error: { message: `unknown table ${state.table}` } };

      if (state.mode === 'insert') {
        const inserts = state.inserts ?? [];
        for (const row of inserts) {
          const check = rejectUnknownColumns(row);
          if (!check.ok) return { data: null, error: { message: check.message! } };
        }
        const withIds = inserts.map((r) => ({
          id:
            typeof r.id === 'string'
              ? r.id
              : `generated-${Math.random().toString(36).slice(2, 10)}`,
          ...r,
        }));
        tableRows.push(...withIds);
        return { data: withIds.length === 1 ? withIds[0] : withIds, error: null };
      }
      if (state.mode === 'update') {
        const check = rejectUnknownColumns(state.payload ?? {});
        if (!check.ok) return { data: null, error: { message: check.message! } };
        const matched = applyFilters(tableRows, state.filters);
        for (const row of matched) Object.assign(row, state.payload);
        if (matched.length === 0) return { data: null, error: null };
        return { data: matched.length === 1 ? matched[0] : matched, error: null };
      }
      // select
      const rows = applyFilters(tableRows, state.filters);
      return { data: rows.length === 1 ? rows[0] : rows.length > 1 ? rows : null, error: null };
    };

    return {
      then(resolve: (v: { data: unknown; error: { message: string } | null }) => unknown) {
        return exec().then(resolve);
      },
      eq(col: string, val: unknown) {
        state.filters.push({ col, val });
        return buildThenable(state);
      },
      select(cols?: string) {
        if (cols !== undefined) state.selectColumns = cols;
        // Allow chaining .eq afterwards.
        return buildThenable(state);
      },
      maybeSingle: async () => {
        const { data, error } = await exec();
        if (error) return { data: null, error };
        if (Array.isArray(data)) return { data: data[0] ?? null, error: null };
        return { data: data ?? null, error: null };
      },
      single: async () => {
        const { data, error } = await exec();
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
            select(cols?: string) {
              const q = newQuery(name, table);
              q.mode = 'select';
              if (cols !== undefined) q.selectColumns = cols;
              return buildThenable(q);
            },
            update(payload: Row) {
              const q = newQuery(name, table);
              q.mode = 'update';
              q.payload = payload;
              return buildThenable(q);
            },
            insert(payload: Row | Row[]) {
              const q = newQuery(name, table);
              q.mode = 'insert';
              q.inserts = Array.isArray(payload) ? payload : [payload];
              return buildThenable(q);
            },
          };
        },
      };
    },
  };

  return { supabase: supabase as never, db };
}

// ---------------------------------------------------------------------------

function makePending(overrides: Partial<SuggestionRow> = {}): SuggestionRow {
  return {
    id: 's1',
    household_id: 'h1',
    segment: 'fun',
    kind: 'outing_idea',
    title: 'Trip to the park',
    rationale: 'Free weekend + preference match',
    preview: { place: 'park', when: '2025-06-01T10:00:00Z' },
    status: 'pending',
    created_at: '2025-01-01T00:00:00Z',
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  };
}

function makeAction(overrides: Partial<ActionRow> = {}): ActionRow {
  return {
    id: 'a1',
    household_id: 'h1',
    suggestion_id: 's1',
    segment: 'fun',
    kind: 'outing_idea',
    payload: { [ACTION_SUGGESTION_HASH_KEY]: 'abc' },
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

describe('getApprovalState', () => {
  it('throws NOT_FOUND when the suggestion does not exist', async () => {
    const { supabase } = makeFakeSupabase();
    await expect(getApprovalState(supabase, 'missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('returns quorumMet=false when there are no approvers', async () => {
    const { supabase } = makeFakeSupabase({ suggestions: [makePending() as unknown as Row] });
    const state = await getApprovalState(supabase, 's1');
    expect(state.quorumMet).toBe(false);
    expect(state.eligibleToExecute).toBe(false);
  });
});

describe('approveSuggestion', () => {
  let now: Date;
  beforeEach(() => {
    now = new Date('2025-02-01T12:00:00Z');
  });

  it('approves a pending suggestion (quorum=1)', async () => {
    const { supabase, db } = makeFakeSupabase({
      suggestions: [makePending() as unknown as Row],
    });
    const state = await approveSuggestion(
      supabase,
      { suggestionId: 's1', actorMemberId: 'm1' },
      { now: () => now },
    );
    expect(state.suggestion.status).toBe('approved');
    expect(state.quorumMet).toBe(true);
    expect(state.eligibleToExecute).toBe(true);

    const updated = db.app.suggestion[0]!;
    expect(updated.status).toBe('approved');
    expect(updated.resolved_by).toBe('m1');
    expect(updated.canonical_hash).toMatch(/^[0-9a-f]{64}$/);

    expect(db.audit.event).toHaveLength(1);
    expect(db.audit.event[0]!.action).toBe('suggestion.approved');
  });

  it('is idempotent for repeated approvals by the same actor', async () => {
    const already = makePending({
      preview: {
        place: 'park',
        __approvers: [{ memberId: 'm1', approvedAt: '2025-01-15T00:00:00Z' }],
      },
    });
    const { supabase } = makeFakeSupabase({
      suggestions: [already as unknown as Row],
    });
    // Note: row is still pending because quorum=1 requires 1 approver, but
    // the fallback test uses a pretend-policy of quorum=2 to show dedup.
    const state = await approveSuggestion(
      supabase,
      {
        suggestionId: 's1',
        actorMemberId: 'm1',
        policyOverrides: { requiresQuorum: 2 },
      },
      { now: () => now },
    );
    expect(state.approvers).toHaveLength(1);
    expect(state.quorumMet).toBe(false);
  });

  it('throws ALREADY_FINALIZED when the suggestion is rejected', async () => {
    const { supabase } = makeFakeSupabase({
      suggestions: [makePending({ status: 'rejected' }) as unknown as Row],
    });
    await expect(
      approveSuggestion(supabase, { suggestionId: 's1', actorMemberId: 'm1' }),
    ).rejects.toMatchObject({ code: 'ALREADY_FINALIZED' });
  });

  it('is idempotent when the suggestion is already approved', async () => {
    const { supabase } = makeFakeSupabase({
      suggestions: [
        makePending({
          status: 'approved',
          preview: {
            place: 'park',
            __approvers: [{ memberId: 'm1', approvedAt: '2025-01-15T00:00:00Z' }],
          },
        }) as unknown as Row,
      ],
    });
    const state = await approveSuggestion(supabase, {
      suggestionId: 's1',
      actorMemberId: 'm1',
    });
    expect(state.suggestion.status).toBe('approved');
  });

  it('accumulates approvers for quorum=2 and only approves on the second tap', async () => {
    const { supabase, db } = makeFakeSupabase({
      suggestions: [makePending() as unknown as Row],
    });
    const first = await approveSuggestion(
      supabase,
      {
        suggestionId: 's1',
        actorMemberId: 'm1',
        policyOverrides: { requiresQuorum: 2 },
      },
      { now: () => now },
    );
    expect(first.suggestion.status).toBe('pending');
    expect(first.quorumMet).toBe(false);
    expect(first.approvers).toHaveLength(1);

    const second = await approveSuggestion(
      supabase,
      {
        suggestionId: 's1',
        actorMemberId: 'm2',
        policyOverrides: { requiresQuorum: 2 },
      },
      { now: () => now },
    );
    expect(second.suggestion.status).toBe('approved');
    expect(second.quorumMet).toBe(true);
    expect(second.approvers).toHaveLength(2);

    const stored = db.app.suggestion[0]!;
    expect(stored.status).toBe('approved');
  });

  it('writes suggestion.auto_approved when actorMemberId is null', async () => {
    const { supabase, db } = makeFakeSupabase({
      suggestions: [makePending() as unknown as Row],
    });
    const state = await approveSuggestion(
      supabase,
      { suggestionId: 's1', actorMemberId: null },
      { now: () => now },
    );
    expect(state.suggestion.status).toBe('approved');
    expect(db.audit.event[0]!.action).toBe('suggestion.auto_approved');
  });

  it('falls back when canonical_hash column is missing', async () => {
    const failColumns = new Set(['canonical_hash', 'approvers']);
    const { supabase, db } = makeFakeSupabase({
      suggestions: [makePending() as unknown as Row],
      failColumns,
    });
    const state = await approveSuggestion(
      supabase,
      { suggestionId: 's1', actorMemberId: 'm1' },
      { now: () => now },
    );
    expect(state.suggestion.status).toBe('approved');
    const stored = db.app.suggestion[0]!;
    expect(stored.status).toBe('approved');
    // Fallback path persists approvers inside preview.
    const preview = stored.preview as Record<string, unknown>;
    expect(Array.isArray(preview.__approvers)).toBe(true);
  });
});

describe('rejectSuggestion', () => {
  it('sets status=rejected and writes audit', async () => {
    const { supabase, db } = makeFakeSupabase({
      suggestions: [makePending() as unknown as Row],
    });
    await rejectSuggestion(supabase, {
      suggestionId: 's1',
      actorMemberId: 'm1',
      reason: 'Not interested',
    });
    expect(db.app.suggestion[0]!.status).toBe('rejected');
    expect(db.audit.event[0]!.action).toBe('suggestion.rejected');
  });

  it('is idempotent for already-rejected suggestions', async () => {
    const { supabase } = makeFakeSupabase({
      suggestions: [makePending({ status: 'rejected' }) as unknown as Row],
    });
    await expect(
      rejectSuggestion(supabase, { suggestionId: 's1', actorMemberId: 'm1' }),
    ).resolves.toBeUndefined();
  });

  it('throws ALREADY_FINALIZED for approved suggestions', async () => {
    const { supabase } = makeFakeSupabase({
      suggestions: [makePending({ status: 'approved' }) as unknown as Row],
    });
    await expect(
      rejectSuggestion(supabase, { suggestionId: 's1', actorMemberId: 'm1' }),
    ).rejects.toMatchObject({ code: 'ALREADY_FINALIZED' });
  });
});

describe('dispatchAction', () => {
  it('refuses to dispatch a pending suggestion', async () => {
    const { supabase } = makeFakeSupabase({
      suggestions: [makePending() as unknown as Row],
    });
    await expect(
      dispatchAction(supabase, {
        suggestionId: 's1',
        kind: 'outing_idea',
        payload: {},
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_FINALIZED' });
  });

  it('creates an action row with suggestion_hash embedded', async () => {
    const { supabase, db } = makeFakeSupabase({
      suggestions: [makePending({ status: 'approved' }) as unknown as Row],
    });
    const res = await dispatchAction(supabase, {
      suggestionId: 's1',
      kind: 'outing_idea',
      payload: { event_id: 'e1' },
      actorMemberId: 'm1',
    });
    expect(res.actionId).toBeDefined();
    expect(db.app.action).toHaveLength(1);
    const payload = db.app.action[0]!.payload as Record<string, unknown>;
    expect(payload.event_id).toBe('e1');
    expect(typeof payload[ACTION_SUGGESTION_HASH_KEY]).toBe('string');
    expect(db.audit.event.some((e) => e.action === 'action.dispatched')).toBe(true);
  });

  it('throws NOT_FOUND when the suggestion is missing', async () => {
    const { supabase } = makeFakeSupabase();
    await expect(
      dispatchAction(supabase, {
        suggestionId: 'missing',
        kind: 'outing_idea',
        payload: {},
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('transitionAction', () => {
  it('transitions pending → running and writes audit', async () => {
    const { supabase, db } = makeFakeSupabase({
      actions: [makeAction() as unknown as Row],
    });
    const next = await transitionAction(supabase, 'a1', 'running');
    expect(next.status).toBe('running');
    expect(db.app.action[0]!.started_at).toBeDefined();
    expect(db.audit.event[0]!.action).toBe('action.started');
  });

  it('is idempotent when the action is already in the target status', async () => {
    const { supabase, db } = makeFakeSupabase({
      actions: [makeAction({ status: 'running' }) as unknown as Row],
    });
    const res = await transitionAction(supabase, 'a1', 'running');
    expect(res.status).toBe('running');
    // No audit row should be written for a same-status read.
    expect(db.audit.event).toHaveLength(0);
  });

  it('records result + finished_at on succeeded', async () => {
    const { supabase, db } = makeFakeSupabase({
      actions: [makeAction({ status: 'running' }) as unknown as Row],
    });
    const res = await transitionAction(supabase, 'a1', 'succeeded', {
      result: { ok: true },
    });
    expect(res.status).toBe('succeeded');
    expect(db.app.action[0]!.result).toEqual({ ok: true });
    expect(db.app.action[0]!.finished_at).toBeDefined();
  });

  it('records error on failed', async () => {
    const { supabase, db } = makeFakeSupabase({
      actions: [makeAction({ status: 'running' }) as unknown as Row],
    });
    await transitionAction(supabase, 'a1', 'failed', { error: 'boom' });
    expect(db.app.action[0]!.error).toBe('boom');
    expect(db.audit.event[0]!.action).toBe('action.failed');
  });
});

describe('extractApprovers', () => {
  it('pulls from the top-level column when present', () => {
    const row = makePending({
      approvers: [{ memberId: 'm1', approvedAt: '2025-01-01T00:00:00Z' }],
    });
    expect(extractApprovers(row)).toHaveLength(1);
  });

  it('falls back to preview.__approvers', () => {
    const row = makePending({
      preview: {
        place: 'park',
        __approvers: [{ memberId: 'm1', approvedAt: '2025-01-01T00:00:00Z' }],
      },
    });
    expect(extractApprovers(row)).toHaveLength(1);
  });

  it('returns an empty array when none exist', () => {
    expect(extractApprovers(makePending())).toEqual([]);
  });
});

describe('ApprovalError', () => {
  it('carries a stable code', () => {
    const e = new ApprovalError('x', 'TAMPER_DETECTED');
    expect(e.code).toBe('TAMPER_DETECTED');
    expect(e.name).toBe('ApprovalError');
  });
});
