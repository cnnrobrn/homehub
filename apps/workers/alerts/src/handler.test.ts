/**
 * Unit tests for the alerts worker handler.
 *
 * Strategy: in-memory supabase stub with the minimum surface the handler
 * uses (app.household, app.transaction, app.account, app.budget,
 * app.alert, mem.node, audit.event).
 *
 * Covers:
 *   - Happy path: transactions → detectors fire → alerts inserted,
 *     subscription detected + node created + node_regen enqueued.
 *   - Dedupe: an active alert with the same `(kind, dedupe_key)` stored
 *     in context suppresses the new emission.
 *   - Member-confirmed subscription node (needs_review=false) is not
 *     overwritten.
 *   - Household settings override the large_transaction threshold.
 */

import { type Logger, type MessageEnvelope, type QueueClient } from '@homehub/worker-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runAlertsWorker } from './handler.js';

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
  transactions: Row[];
  accounts: Row[];
  budgets: Row[];
  alerts: Row[];
  nodes: Row[];
  audits: Row[];
}

function makeSupabase(initial: Partial<State> = {}) {
  const state: State = {
    households: initial.households ?? [],
    transactions: initial.transactions ?? [],
    accounts: initial.accounts ?? [],
    budgets: initial.budgets ?? [],
    alerts: initial.alerts ?? [],
    nodes: initial.nodes ?? [],
    audits: initial.audits ?? [],
  };
  let alertId = 1;
  let nodeId = 1;

  function buildQuery(
    rows: Row[],
    opts: { mutatorKey?: 'alerts' | 'nodes' | 'transactions' } = {},
  ) {
    const filters: Record<string, unknown> = {};
    const gteConds: Array<{ col: string; value: string }> = [];
    const ltConds: Array<{ col: string; value: string }> = [];
    let limit: number | undefined;
    let selectCols: string | undefined;
    let selectHead = false;
    let insertPayload: Row | undefined;
    let updatePayload: Partial<Row> | undefined;
    const chain: Record<string, unknown> = {
      select(cols?: string, o?: { count?: string; head?: boolean }) {
        selectCols = cols;
        if (o?.head) selectHead = true;
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
      update(payload: Partial<Row>) {
        updatePayload = { ...payload };
        return chain;
      },
      maybeSingle() {
        const result = applyFilters(rows);
        return Promise.resolve({ data: result[0] ?? null, error: null });
      },
      single() {
        if (insertPayload) {
          const id = opts.mutatorKey === 'nodes' ? `node-${nodeId++}` : `alert-${alertId++}`;
          const row = { ...insertPayload, id };
          if (opts.mutatorKey === 'nodes') state.nodes.push(row);
          if (opts.mutatorKey === 'alerts') state.alerts.push(row);
          return Promise.resolve({ data: { id }, error: null });
        }
        const result = applyFilters(rows);
        return Promise.resolve({ data: result[0] ?? null, error: null });
      },
      then(fulfill: (v: unknown) => unknown) {
        if (insertPayload) {
          const id = opts.mutatorKey === 'nodes' ? `node-${nodeId++}` : `alert-${alertId++}`;
          const row = { ...insertPayload, id };
          if (opts.mutatorKey === 'nodes') state.nodes.push(row);
          else if (opts.mutatorKey === 'alerts') state.alerts.push(row);
          return Promise.resolve(fulfill({ data: null, error: null }));
        }
        if (updatePayload) {
          const id = filters.id as string;
          if (opts.mutatorKey === 'transactions') {
            const idx = state.transactions.findIndex((r) => r.id === id);
            if (idx >= 0)
              state.transactions[idx] = { ...state.transactions[idx]!, ...updatePayload };
          }
          if (opts.mutatorKey === 'nodes') {
            const idx = state.nodes.findIndex((r) => r.id === id);
            if (idx >= 0) state.nodes[idx] = { ...state.nodes[idx]!, ...updatePayload };
          }
          return Promise.resolve(fulfill({ data: null, error: null }));
        }
        const result = applyFilters(rows);
        if (selectHead)
          return Promise.resolve(fulfill({ data: null, error: null, count: result.length }));
        void selectCols;
        return Promise.resolve(fulfill({ data: result, error: null }));
      },
    };

    function applyFilters(input: Row[]): Row[] {
      let out = input.slice();
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
      return out;
    }

    return chain;
  }

  function appSchema(table: string) {
    switch (table) {
      case 'household':
        return buildQuery(state.households);
      case 'transaction':
        return buildQuery(state.transactions, { mutatorKey: 'transactions' });
      case 'account':
        return buildQuery(state.accounts);
      case 'budget':
        return buildQuery(state.budgets);
      case 'alert':
        return buildQuery(state.alerts, { mutatorKey: 'alerts' });
      default:
        throw new Error(`unexpected app.${table}`);
    }
  }

  function memSchema(table: string) {
    if (table === 'node') return buildQuery(state.nodes, { mutatorKey: 'nodes' });
    throw new Error(`unexpected mem.${table}`);
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
        if (name === 'mem') return { from: (t: string) => memSchema(t) };
        if (name === 'audit') return { from: (t: string) => auditSchema(t) };
        throw new Error(`unexpected schema ${name}`);
      },
    },
  };
}

function makeQueues() {
  const sent: Array<{ queue: string; payload: MessageEnvelope }> = [];
  const queues: QueueClient = {
    claim: vi.fn(),
    ack: vi.fn(),
    nack: vi.fn(),
    send: vi.fn(async (queue, payload) => {
      sent.push({ queue, payload });
      return 1;
    }),
    sendBatch: vi.fn(),
    deadLetter: vi.fn(),
    depth: vi.fn(),
    ageOfOldestSec: vi.fn(),
  } as unknown as QueueClient;
  return { queues, sent };
}

const HOUSEHOLD_ID = 'h0000000-0000-4000-8000-000000000001';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runAlertsWorker', () => {
  const now = new Date('2026-04-22T06:00:00Z');

  it('happy path: detects subscription + fires detectors + inserts alerts', async () => {
    const { supabase, state } = makeSupabase({
      households: [{ id: HOUSEHOLD_ID, settings: {} }],
      transactions: [
        // 3 matching Netflix charges ≈ monthly → subscription candidate
        makeTx('t-1', '2026-02-10T00:00:00Z', -1599, 'Netflix'),
        makeTx('t-2', '2026-03-10T00:00:00Z', -1599, 'Netflix'),
        makeTx('t-3', '2026-04-10T00:00:00Z', -1599, 'Netflix'),
        // Large transaction
        makeTx('t-large', '2026-04-20T00:00:00Z', -800_00, 'Apple Store'),
      ],
      accounts: [
        {
          id: 'a-old',
          household_id: HOUSEHOLD_ID,
          name: 'Stale Savings',
          kind: 'savings',
          balance_cents: 1000_00,
          currency: 'USD',
          last_synced_at: '2026-04-01T00:00:00Z',
        },
      ],
      budgets: [],
    });
    const { queues, sent } = makeQueues();

    const summaries = await runAlertsWorker({
      supabase: supabase as never,
      queues,
      log: makeLog(),
      now: () => now,
    });

    expect(summaries).toHaveLength(1);
    const s = summaries[0]!;
    expect(s.subscriptionsCreated).toBe(1);
    // node created
    expect(state.nodes).toHaveLength(1);
    expect(state.nodes[0]!.type).toBe('subscription');
    expect(state.nodes[0]!.canonical_name).toBe('Netflix');
    // node_regen enqueued for new subscription
    expect(sent.some((m) => m.queue === 'node_regen')).toBe(true);
    // At least: large_transaction + account_stale + new_recurring_charge
    const kinds = state.alerts.map((a) => (a.context as Record<string, unknown>).alert_kind);
    expect(kinds).toContain('large_transaction');
    expect(kinds).toContain('account_stale');
    expect(kinds).toContain('new_recurring_charge');
    // Audit row
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]!.action).toBe('alerts.generated');
  });

  it('dedupe: active alert with same (kind, dedupe_key) suppresses new emission', async () => {
    const { supabase, state } = makeSupabase({
      households: [{ id: HOUSEHOLD_ID, settings: {} }],
      transactions: [makeTx('t-large', '2026-04-20T00:00:00Z', -800_00, 'Apple Store')],
      alerts: [
        {
          id: 'pre-existing',
          household_id: HOUSEHOLD_ID,
          segment: 'financial',
          severity: 'info',
          title: 'Large transaction: $800.00 at Apple Store',
          body: 'dup',
          generated_by: 'alerts-worker',
          generated_at: '2026-04-22T00:00:00Z',
          dismissed_at: null,
          context: {
            alert_kind: 'large_transaction',
            alert_dedupe_key: 't-large',
          },
        },
      ],
    });
    const { queues } = makeQueues();

    const summaries = await runAlertsWorker({
      supabase: supabase as never,
      queues,
      log: makeLog(),
      now: () => now,
    });

    // No new rows for large_transaction.
    const kinds = state.alerts
      .filter((a) => a.id !== 'pre-existing')
      .map((a) => (a.context as Record<string, unknown>).alert_kind);
    expect(kinds).not.toContain('large_transaction');
    expect(summaries[0]!.dedupedSuppressed).toBeGreaterThan(0);
  });

  it('does not overwrite member-confirmed subscription (needs_review=false)', async () => {
    const { supabase, state } = makeSupabase({
      households: [{ id: HOUSEHOLD_ID, settings: {} }],
      transactions: [
        makeTx('t-1', '2026-02-10T00:00:00Z', -999, 'Netflix'),
        makeTx('t-2', '2026-03-10T00:00:00Z', -999, 'Netflix'),
        makeTx('t-3', '2026-04-10T00:00:00Z', -999, 'Netflix'),
      ],
      nodes: [
        {
          id: 'member-created',
          household_id: HOUSEHOLD_ID,
          type: 'subscription',
          canonical_name: 'Netflix',
          metadata: { cadence: 'monthly', price_cents: 999, custom_note: 'keep me' },
          needs_review: false,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
    });
    const { queues } = makeQueues();

    await runAlertsWorker({
      supabase: supabase as never,
      queues,
      log: makeLog(),
      now: () => now,
    });

    // Still only one node, and its metadata is untouched.
    expect(state.nodes).toHaveLength(1);
    expect(state.nodes[0]!.id).toBe('member-created');
    const meta = state.nodes[0]!.metadata as Record<string, unknown>;
    expect(meta.custom_note).toBe('keep me');
  });

  it('respects household-configured large_transaction threshold', async () => {
    const { supabase, state } = makeSupabase({
      households: [
        {
          id: HOUSEHOLD_ID,
          settings: { financial: { large_transaction_threshold_cents: 100_00 } },
        },
      ],
      transactions: [makeTx('t-1', '2026-04-20T00:00:00Z', -150_00, 'Chipotle')],
    });
    const { queues } = makeQueues();

    await runAlertsWorker({
      supabase: supabase as never,
      queues,
      log: makeLog(),
      now: () => now,
    });

    const kinds = state.alerts.map((a) => (a.context as Record<string, unknown>).alert_kind);
    expect(kinds).toContain('large_transaction');
  });
});

function makeTx(id: string, occurredAt: string, amountCents: number, merchant: string): Row {
  return {
    id,
    household_id: HOUSEHOLD_ID,
    account_id: 'a-1',
    occurred_at: occurredAt,
    amount_cents: amountCents,
    currency: 'USD',
    merchant_raw: merchant,
    category: null,
    source: 'ynab',
    metadata: {},
  };
}
