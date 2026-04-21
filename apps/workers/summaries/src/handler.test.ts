/**
 * Unit tests for the summaries worker handler.
 *
 * Strategy: stub supabase with an in-memory row set; assert:
 *   - Happy path: new summary written, audit row emitted.
 *   - Idempotency: existing covered_start row → skip.
 *   - Empty household: still inserts a "no activity" summary.
 *   - Multi-period: weekly + monthly both produced.
 *   - computePeriodWindow helper boundaries (weekly / monthly / daily).
 */

import { type Logger } from '@homehub/worker-runtime';
import { describe, expect, it } from 'vitest';

import { computePeriodWindow, runSummariesWorker } from './handler.js';

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
  household_id: string;
  [k: string]: unknown;
}

interface SupabaseState {
  households: Row[];
  transactions: Row[];
  accounts: Row[];
  budgets: Row[];
  summaries: Row[];
  audits: Row[];
}

function makeSupabase(initial: Partial<SupabaseState> = {}) {
  const state: SupabaseState = {
    households: initial.households ?? [],
    transactions: initial.transactions ?? [],
    accounts: initial.accounts ?? [],
    budgets: initial.budgets ?? [],
    summaries: initial.summaries ?? [],
    audits: initial.audits ?? [],
  };
  let summaryId = 1;

  function build(rows: Row[]) {
    const filters: Record<string, unknown> = {};
    const gteConds: Array<{ col: string; value: string }> = [];
    const ltConds: Array<{ col: string; value: string }> = [];
    let selectCols: string | undefined;
    let selectHead = false;
    let insertPayload: Row | undefined;
    let limit: number | undefined;

    const chain: Record<string, unknown> = {
      select(cols?: string, opts?: { count?: string; head?: boolean }) {
        selectCols = cols;
        if (opts?.head) selectHead = true;
        return chain;
      },
      eq(col: string, val: unknown) {
        filters[col] = val;
        return chain;
      },
      gte(col: string, value: string) {
        gteConds.push({ col, value });
        return chain;
      },
      lt(col: string, value: string) {
        ltConds.push({ col, value });
        return chain;
      },
      limit(n: number) {
        limit = n;
        return chain;
      },
      insert(payload: Row) {
        insertPayload = { ...payload };
        return chain;
      },
      single() {
        if (insertPayload) {
          const row = { ...insertPayload, id: `sum-${summaryId++}` };
          state.summaries.push(row);
          return Promise.resolve({ data: { id: row.id }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then(fulfill: (v: unknown) => unknown) {
        if (insertPayload) {
          // Non-select insert: push and resolve.
          const row = { ...insertPayload, id: `sum-${summaryId++}` };
          // Detect audit vs summary based on cols present.
          if ('body_md' in insertPayload) state.summaries.push(row);
          else state.audits.push(row);
          return Promise.resolve(fulfill({ data: null, error: null }));
        }
        let out = rows.slice();
        for (const [k, v] of Object.entries(filters)) {
          out = out.filter((r) => r[k] === v);
        }
        for (const cond of gteConds) {
          out = out.filter((r) => String(r[cond.col]) >= cond.value);
        }
        for (const cond of ltConds) {
          out = out.filter((r) => String(r[cond.col]) < cond.value);
        }
        if (limit != null) out = out.slice(0, limit);
        void selectCols;
        if (selectHead) {
          return Promise.resolve(fulfill({ data: null, error: null, count: out.length }));
        }
        return Promise.resolve(fulfill({ data: out, error: null }));
      },
    };
    return chain;
  }

  function appSchema(table: string) {
    switch (table) {
      case 'household':
        return build(state.households);
      case 'transaction':
        return build(state.transactions);
      case 'account':
        return build(state.accounts);
      case 'budget':
        return build(state.budgets);
      case 'summary':
        return build(state.summaries);
      default:
        throw new Error(`unexpected app.${table}`);
    }
  }

  function auditSchema(_table: string) {
    return {
      insert: async (row: Row) => {
        state.audits.push({ ...row, id: `aud-${state.audits.length + 1}` });
        return { data: null, error: null };
      },
    };
  }

  return {
    state,
    supabase: {
      schema(name: string) {
        if (name === 'app') return { from: (t: string) => appSchema(t) };
        if (name === 'audit') return { from: (t: string) => auditSchema(t) };
        throw new Error(`unexpected schema ${name}`);
      },
    },
  };
}

const HOUSEHOLD_ID = 'h0000000-0000-4000-8000-000000000001';

describe('computePeriodWindow', () => {
  it('weekly: covers previous Mon→Mon when run on Monday 04:00', () => {
    const now = new Date('2026-04-20T04:00:00Z'); // Monday
    const out = computePeriodWindow('weekly', now);
    expect(out.coveredStart).toBe('2026-04-13T00:00:00.000Z');
    expect(out.coveredEnd).toBe('2026-04-20T00:00:00.000Z');
    expect(out.priorStart).toBe('2026-04-06T00:00:00.000Z');
    expect(out.priorEnd).toBe('2026-04-13T00:00:00.000Z');
  });
  it('monthly: covers previous month when run on the 1st', () => {
    const now = new Date('2026-05-01T05:00:00Z');
    const out = computePeriodWindow('monthly', now);
    expect(out.coveredStart).toBe('2026-04-01T00:00:00.000Z');
    expect(out.coveredEnd).toBe('2026-05-01T00:00:00.000Z');
  });
  it('daily: covers previous day', () => {
    const now = new Date('2026-04-20T06:00:00Z');
    const out = computePeriodWindow('daily', now);
    expect(out.coveredStart).toBe('2026-04-19T00:00:00.000Z');
    expect(out.coveredEnd).toBe('2026-04-20T00:00:00.000Z');
  });
});

describe('runSummariesWorker', () => {
  const now = new Date('2026-04-20T04:00:00Z'); // Monday

  it('happy path: writes a summary and an audit row', async () => {
    const { supabase, state } = makeSupabase({
      households: [{ id: HOUSEHOLD_ID, household_id: HOUSEHOLD_ID }],
      transactions: [
        {
          id: 't-1',
          household_id: HOUSEHOLD_ID,
          account_id: 'a-1',
          occurred_at: '2026-04-15T12:00:00Z',
          amount_cents: -50_00,
          currency: 'USD',
          merchant_raw: 'Trader Joe',
          category: 'Groceries',
          source: 'ynab',
          metadata: {},
        },
      ],
      accounts: [
        {
          id: 'a-1',
          household_id: HOUSEHOLD_ID,
          name: 'Checking',
          kind: 'checking',
          balance_cents: 100_000,
          currency: 'USD',
          last_synced_at: '2026-04-19T12:00:00Z',
        },
      ],
      budgets: [],
    });

    const results = await runSummariesWorker({
      supabase: supabase as never,
      log: makeLog(),
      now: () => now,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.skipped).toBe(false);
    expect(state.summaries).toHaveLength(1);
    expect(state.summaries[0]!.segment).toBe('financial');
    expect(state.summaries[0]!.period).toBe('weekly');
    expect(state.summaries[0]!.model).toBe('deterministic');
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]!.action).toBe('summary.financial.generated');
  });

  it('idempotency: an existing summary for the covered_start is skipped', async () => {
    const { supabase, state } = makeSupabase({
      households: [{ id: HOUSEHOLD_ID, household_id: HOUSEHOLD_ID }],
      summaries: [
        {
          id: 'sum-existing',
          household_id: HOUSEHOLD_ID,
          segment: 'financial',
          period: 'weekly',
          covered_start: '2026-04-13T00:00:00.000Z',
          covered_end: '2026-04-20T00:00:00.000Z',
          body_md: 'prior',
          model: 'deterministic',
        },
      ],
    });
    const results = await runSummariesWorker({
      supabase: supabase as never,
      log: makeLog(),
      now: () => now,
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.skipped).toBe(true);
    expect(results[0]!.reason).toBe('already_exists');
    // No new summary row.
    expect(state.summaries).toHaveLength(1);
    expect(state.audits).toHaveLength(0);
  });

  it('empty household: still inserts a "no activity" summary', async () => {
    const { supabase, state } = makeSupabase({
      households: [{ id: HOUSEHOLD_ID, household_id: HOUSEHOLD_ID }],
    });
    await runSummariesWorker({
      supabase: supabase as never,
      log: makeLog(),
      now: () => now,
    });
    expect(state.summaries).toHaveLength(1);
    expect(state.summaries[0]!.body_md).toContain('No financial activity');
  });

  it('multi-period: weekly + monthly both produced', async () => {
    const { supabase, state } = makeSupabase({
      households: [{ id: HOUSEHOLD_ID, household_id: HOUSEHOLD_ID }],
    });
    const may1 = new Date('2026-05-01T05:00:00Z');
    const results = await runSummariesWorker({
      supabase: supabase as never,
      log: makeLog(),
      now: () => may1,
      periods: ['weekly', 'monthly'],
    });
    expect(results).toHaveLength(2);
    expect(results.filter((r) => !r.skipped)).toHaveLength(2);
    expect(state.summaries).toHaveLength(2);
    const periods = state.summaries.map((r) => r.period as string).sort();
    expect(periods).toEqual(['monthly', 'weekly']);
  });
});
