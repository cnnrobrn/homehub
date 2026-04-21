/**
 * Unit tests for the sync-financial handler.
 *
 * Strategy: stub every external — Supabase (schema/from/select/upsert),
 * the QueueClient, and the FinancialProvider. No network, no DB.
 */

import {
  CursorExpiredError,
  type FinancialProvider,
  type FinancialTransaction,
  RateLimitError,
} from '@homehub/providers-financial';
import { type Logger, type QueueClient, queueNames } from '@homehub/worker-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CURSOR_KIND, pollOnce, runFinancialCron } from './handler.js';

// ---- Fakes -------------------------------------------------------------

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

function asyncIterable<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          return i < items.length
            ? { value: items[i++]!, done: false }
            : { value: undefined as never, done: true };
        },
      };
    },
  };
}

function throwingIterable(err: Error): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          throw err;
        },
      };
    },
  };
}

function makeProvider(opts: {
  accounts?: Array<{
    sourceId: string;
    kind: 'checking' | 'credit';
    balanceCents: number;
    name?: string;
  }>;
  txPages?: AsyncIterable<{ transactions: FinancialTransaction[]; nextCursor?: string }>;
  budgets?: Array<{ sourceId: string; name: string; category: string; amountCents: number }>;
}): FinancialProvider {
  const provider: FinancialProvider = {
    listAccounts: async () =>
      (opts.accounts ?? []).map((a) => ({
        sourceId: a.sourceId,
        name: a.name ?? a.sourceId,
        kind: a.kind,
        currency: 'USD',
        balanceCents: a.balanceCents,
        metadata: {},
      })),
    listTransactions: () => opts.txPages ?? asyncIterable([]),
    listBudgets: async () =>
      (opts.budgets ?? []).map((b) => ({
        sourceId: b.sourceId,
        name: b.name,
        category: b.category,
        period: 'monthly' as const,
        amountCents: b.amountCents,
        currency: 'USD',
      })),
  };
  return provider;
}

interface ConnectionRow {
  id: string;
  household_id: string;
  member_id: string | null;
  provider: string;
  nango_connection_id: string;
  status: string;
  metadata: unknown;
}

function makeSupabase(opts: {
  connection: ConnectionRow;
  cursorValue?: string;
  accountUpsertRows?: Array<{ id: string; external_id: string }>;
  transactionUpsertRows?: Array<{ id: string; source_id: string }>;
  activeConnections?: Array<{
    id: string;
    household_id: string;
    provider: string;
    status: string;
  }>;
}) {
  const accountUpserts: Array<Record<string, unknown>[]> = [];
  const transactionUpserts: Array<Record<string, unknown>[]> = [];
  const budgetInserts: Array<Record<string, unknown>[]> = [];
  const cursorUpserts: Array<Record<string, unknown>> = [];
  const cursorDeletes: Array<Record<string, unknown>> = [];
  const connectionUpdates: Array<Record<string, unknown>> = [];
  const auditInserts: Array<Record<string, unknown>> = [];

  const schemaSync = {
    from(table: string): unknown {
      if (table === 'provider_connection') {
        const filters: Record<string, unknown> = {};
        let inFilter: { col: string; values: unknown[] } | undefined;
        const builder = {
          select() {
            return builder;
          },
          eq(col: string, val: unknown) {
            filters[col] = val;
            return builder;
          },
          in(col: string, values: unknown[]) {
            inFilter = { col, values };
            return builder;
          },
          maybeSingle: async () => ({ data: opts.connection, error: null }),
          update(payload: Record<string, unknown>) {
            connectionUpdates.push(payload);
            return { eq: async () => ({ data: null, error: null }) };
          },
          then(resolve: (v: unknown) => void) {
            // Cron path: returns filtered active connections.
            let rows = opts.activeConnections ?? [];
            if (inFilter) {
              rows = rows.filter((r) =>
                inFilter!.values.includes((r as unknown as Record<string, unknown>)[inFilter!.col]),
              );
            }
            for (const [k, v] of Object.entries(filters)) {
              rows = rows.filter((r) => (r as unknown as Record<string, unknown>)[k] === v);
            }
            resolve({ data: rows, error: null });
            return undefined;
          },
        };
        return builder;
      }
      if (table === 'cursor') {
        let whereKind: string | undefined;
        return {
          select() {
            return this;
          },
          eq(col: string, val: unknown) {
            if (col === 'kind') whereKind = String(val);
            return this;
          },
          maybeSingle: async () => {
            if (whereKind === CURSOR_KIND.ynabKnowledge && opts.cursorValue) {
              return {
                data: { kind: CURSOR_KIND.ynabKnowledge, value: opts.cursorValue },
                error: null,
              };
            }
            return { data: null, error: null };
          },
          upsert(payload: Record<string, unknown>) {
            cursorUpserts.push(payload);
            return Promise.resolve({ data: null, error: null });
          },
          delete() {
            const chain = {
              eq() {
                cursorDeletes.push({});
                return chain;
              },
              then(resolve: (v: unknown) => void) {
                resolve({ data: null, error: null });
                return undefined;
              },
            };
            return chain;
          },
        };
      }
      throw new Error(`unexpected sync.${table}`);
    },
  };

  const schemaApp = {
    from(table: string): unknown {
      if (table === 'account') {
        return {
          upsert(rows: Record<string, unknown>[]) {
            accountUpserts.push(rows);
            return {
              select: async () => ({ data: opts.accountUpsertRows ?? [], error: null }),
            };
          },
        };
      }
      if (table === 'transaction') {
        return {
          upsert(rows: Record<string, unknown>[]) {
            transactionUpserts.push(rows);
            return {
              select: async () => ({ data: opts.transactionUpsertRows ?? [], error: null }),
            };
          },
        };
      }
      if (table === 'budget') {
        return {
          insert: async (rows: Record<string, unknown>[]) => {
            budgetInserts.push(rows);
            return { data: null, error: null };
          },
        };
      }
      throw new Error(`unexpected app.${table}`);
    },
  };

  const schemaAudit = {
    from(table: string): unknown {
      if (table !== 'event') throw new Error(`unexpected audit.${table}`);
      return {
        insert: async (row: Record<string, unknown>) => {
          auditInserts.push(row);
          return { data: null, error: null };
        },
      };
    },
  };

  const supabase = {
    schema(name: string) {
      if (name === 'sync') return schemaSync;
      if (name === 'app') return schemaApp;
      if (name === 'audit') return schemaAudit;
      throw new Error(`unexpected schema ${name}`);
    },
  };

  return {
    supabase,
    accountUpserts,
    transactionUpserts,
    budgetInserts,
    cursorUpserts,
    cursorDeletes,
    connectionUpdates,
    auditInserts,
  };
}

function makeQueues(opts?: { claim?: unknown }) {
  const acks: Array<{ queue: string; id: number }> = [];
  const nacks: Array<{ queue: string; id: number; retryDelaySec?: number }> = [];
  const sends: Array<{ queue: string; payload: unknown }> = [];
  const deadLetters: Array<{ queue: string; id: number; reason: string }> = [];

  const claimFn = vi.fn().mockImplementation(async (queue: string) => {
    const claim = opts?.claim as { queue: string; msg: unknown } | undefined;
    if (!claim) return null;
    if (claim.queue !== queue) return null;
    return claim.msg;
  });

  const queues: QueueClient = {
    claim: claimFn,
    ack: vi.fn(async (queue, id) => {
      acks.push({ queue, id });
    }),
    nack: vi.fn(async (queue, id, options) => {
      nacks.push({
        queue,
        id,
        ...(options?.retryDelaySec ? { retryDelaySec: options.retryDelaySec } : {}),
      });
    }),
    send: vi.fn(async (queue, payload) => {
      sends.push({ queue, payload });
      return 1;
    }),
    sendBatch: vi.fn(async (_queue, payloads) => payloads.map((_p: unknown, i: number) => i + 1)),
    deadLetter: vi.fn(async (queue, id, reason) => {
      deadLetters.push({ queue, id, reason });
    }),
    depth: vi.fn(),
    ageOfOldestSec: vi.fn(),
  } as unknown as QueueClient;

  return { queues, acks, nacks, sends, deadLetters };
}

const CONNECTION_ID = 'c0000000-0000-4000-8000-000000000001';
const HOUSEHOLD_ID = 'a0000000-0000-4000-8000-000000000001';
const MEMBER_ID = 'b0000000-0000-4000-8000-000000000001';

const CONNECTION: ConnectionRow = {
  id: CONNECTION_ID,
  household_id: HOUSEHOLD_ID,
  member_id: MEMBER_ID,
  provider: 'ynab',
  nango_connection_id: 'nango-ynab-1',
  status: 'active',
  metadata: { ynab_budget_id: 'b1' },
};

function envelope(kind: string) {
  return {
    household_id: HOUSEHOLD_ID,
    kind,
    entity_id: CONNECTION_ID,
    version: 1,
    enqueued_at: '2026-04-20T12:00:00.000Z',
  };
}

function tx(id: string, accountSourceId: string, amountCents: number): FinancialTransaction {
  return {
    sourceId: id,
    accountSourceId,
    occurredAt: '2026-04-19',
    amountCents,
    currency: 'USD',
    merchantRaw: 'Blue Bottle',
    cleared: true,
    metadata: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- Happy full --------------------------------------------------------

describe('pollOnce — happy full', () => {
  it('upserts accounts + transactions + budgets, writes cursor, acks', async () => {
    const fullQ = queueNames.syncFull('ynab');
    const { queues, acks } = makeQueues({
      claim: {
        queue: fullQ,
        msg: {
          messageId: 42,
          readCount: 1,
          enqueuedAt: '2026-04-20T11:59:00Z',
          vt: 'now',
          payload: envelope('sync.ynab.full'),
        },
      },
    });
    const {
      supabase,
      accountUpserts,
      transactionUpserts,
      budgetInserts,
      cursorUpserts,
      connectionUpdates,
      auditInserts,
    } = makeSupabase({
      connection: CONNECTION,
      accountUpsertRows: [
        { id: 'db-a1', external_id: 'y-a1' },
        { id: 'db-a2', external_id: 'y-a2' },
      ],
      transactionUpsertRows: [
        { id: 'db-t1', source_id: 't1' },
        { id: 'db-t2', source_id: 't2' },
      ],
    });

    const provider = makeProvider({
      accounts: [
        { sourceId: 'y-a1', kind: 'checking', balanceCents: 123_400, name: 'Checking' },
        { sourceId: 'y-a2', kind: 'credit', balanceCents: -50_000, name: 'Credit' },
      ],
      txPages: asyncIterable([
        {
          transactions: [tx('t1', 'y-a1', -1234), tx('t2', 'y-a1', -500)],
          nextCursor: '100',
        },
      ]),
      budgets: [
        { sourceId: 'b-groceries', name: 'Groceries', category: 'Groceries', amountCents: 50_000 },
      ],
    });

    const result = await pollOnce({
      supabase: supabase as never,
      queues,
      providerFor: () => provider,
      log: makeLog(),
      ingestionEnabled: true,
      now: () => new Date('2026-04-20T12:00:00.000Z'),
    });

    expect(result).toBe('claimed');
    expect(accountUpserts).toHaveLength(1);
    expect(accountUpserts[0]).toHaveLength(2);
    expect(accountUpserts[0]?.[0]).toMatchObject({
      provider: 'ynab',
      external_id: 'y-a1',
      balance_cents: 123_400,
    });
    expect(transactionUpserts).toHaveLength(1);
    expect(transactionUpserts[0]?.[0]).toMatchObject({
      source: 'ynab',
      source_id: 't1',
      amount_cents: -1234,
      account_id: 'db-a1',
    });
    expect(budgetInserts).toHaveLength(1);
    expect(budgetInserts[0]?.[0]).toMatchObject({
      name: 'Groceries',
      period: 'monthly',
      amount_cents: 50_000,
    });
    expect(cursorUpserts).toHaveLength(1);
    expect(cursorUpserts[0]).toMatchObject({ kind: CURSOR_KIND.ynabKnowledge, value: '100' });
    expect(connectionUpdates).toHaveLength(1);
    expect(auditInserts[0]).toMatchObject({ action: 'sync.ynab.full.completed' });
    expect(acks).toEqual([{ queue: fullQ, id: 42 }]);
  });
});

// ---- Happy delta -------------------------------------------------------

describe('pollOnce — happy delta', () => {
  it('passes stored cursor and skips budgets', async () => {
    const deltaQ = queueNames.syncDelta('ynab');
    const { queues } = makeQueues({
      claim: {
        queue: deltaQ,
        msg: {
          messageId: 7,
          readCount: 1,
          enqueuedAt: 'x',
          vt: 'x',
          payload: envelope('sync.ynab.delta'),
        },
      },
    });
    const { supabase, budgetInserts, transactionUpserts, cursorUpserts } = makeSupabase({
      connection: CONNECTION,
      cursorValue: '50',
      accountUpsertRows: [{ id: 'db-a1', external_id: 'y-a1' }],
      transactionUpsertRows: [{ id: 'db-t1', source_id: 't1' }],
    });
    const listTransactionsMock = vi.fn((opts: { sinceCursor?: string }) =>
      asyncIterable([
        {
          transactions: opts.sinceCursor === '50' ? [tx('t1', 'y-a1', -1234)] : [],
          nextCursor: '99',
        },
      ]),
    );
    const listBudgetsMock = vi.fn();
    const provider: FinancialProvider = {
      listAccounts: async () => [
        {
          sourceId: 'y-a1',
          name: 'Checking',
          kind: 'checking' as const,
          currency: 'USD',
          balanceCents: 123_400,
          metadata: {},
        },
      ],
      listTransactions: listTransactionsMock as unknown as FinancialProvider['listTransactions'],
      listBudgets: listBudgetsMock as unknown as FinancialProvider['listBudgets'],
    };

    const result = await pollOnce({
      supabase: supabase as never,
      queues,
      providerFor: () => provider,
      log: makeLog(),
      ingestionEnabled: true,
    });
    expect(result).toBe('claimed');
    expect(listTransactionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ sinceCursor: '50' }),
    );
    expect(budgetInserts).toHaveLength(0);
    expect(listBudgetsMock).not.toHaveBeenCalled();
    expect(transactionUpserts).toHaveLength(1);
    expect(cursorUpserts[0]?.value).toBe('99');
  });
});

// ---- Cursor-expired → full requeue -------------------------------------

describe('pollOnce — cursor-expired', () => {
  it('clears cursor, requeues as sync_full, acks original delta', async () => {
    const deltaQ = queueNames.syncDelta('ynab');
    const fullQ = queueNames.syncFull('ynab');
    const { queues, acks, sends } = makeQueues({
      claim: {
        queue: deltaQ,
        msg: {
          messageId: 7,
          readCount: 1,
          enqueuedAt: 'x',
          vt: 'x',
          payload: envelope('sync.ynab.delta'),
        },
      },
    });
    const { supabase, cursorDeletes, transactionUpserts } = makeSupabase({
      connection: CONNECTION,
      cursorValue: '50',
    });
    const provider: FinancialProvider = {
      listAccounts: vi.fn(async () => []),
      listTransactions: () => throwingIterable(new CursorExpiredError('410')),
      listBudgets: vi.fn(),
    };
    const result = await pollOnce({
      supabase: supabase as never,
      queues,
      providerFor: () => provider,
      log: makeLog(),
      ingestionEnabled: true,
    });
    expect(result).toBe('claimed');
    expect(transactionUpserts).toHaveLength(0);
    expect(cursorDeletes.length).toBeGreaterThan(0);
    expect(sends[0]?.queue).toBe(fullQ);
    expect(sends[0]?.payload).toMatchObject({ kind: 'sync.ynab.full' });
    expect(acks).toEqual([{ queue: deltaQ, id: 7 }]);
  });
});

// ---- Rate limit → nack -------------------------------------------------

describe('pollOnce — rate limit', () => {
  it('nacks with retry-after and does not ack', async () => {
    const deltaQ = queueNames.syncDelta('ynab');
    const { queues, nacks, acks } = makeQueues({
      claim: {
        queue: deltaQ,
        msg: {
          messageId: 9,
          readCount: 1,
          enqueuedAt: 'x',
          vt: 'x',
          payload: envelope('sync.ynab.delta'),
        },
      },
    });
    const { supabase } = makeSupabase({ connection: CONNECTION, cursorValue: '5' });
    const provider: FinancialProvider = {
      listAccounts: vi.fn(async () => []),
      listTransactions: () => throwingIterable(new RateLimitError('429', 73)),
      listBudgets: vi.fn(),
    };
    const result = await pollOnce({
      supabase: supabase as never,
      queues,
      providerFor: () => provider,
      log: makeLog(),
      ingestionEnabled: true,
    });
    expect(result).toBe('claimed');
    expect(nacks).toEqual([{ queue: deltaQ, id: 9, retryDelaySec: 73 }]);
    expect(acks).toEqual([]);
  });
});

// ---- Terminal failure → dead letter ------------------------------------

describe('pollOnce — terminal failure', () => {
  it('dead-letters and acks', async () => {
    const fullQ = queueNames.syncFull('ynab');
    const { queues, deadLetters, acks } = makeQueues({
      claim: {
        queue: fullQ,
        msg: {
          messageId: 13,
          readCount: 1,
          enqueuedAt: 'x',
          vt: 'x',
          payload: envelope('sync.ynab.full'),
        },
      },
    });
    const { supabase } = makeSupabase({ connection: CONNECTION });
    const provider: FinancialProvider = {
      listAccounts: vi.fn(async () => {
        throw new Error('boom');
      }),
      listTransactions: () => asyncIterable([]),
      listBudgets: vi.fn(),
    };
    const result = await pollOnce({
      supabase: supabase as never,
      queues,
      providerFor: () => provider,
      log: makeLog(),
      ingestionEnabled: true,
    });
    expect(result).toBe('claimed');
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0]?.reason).toMatch(/boom/);
    expect(acks).toEqual([{ queue: fullQ, id: 13 }]);
  });
});

// ---- Idempotency -------------------------------------------------------

describe('pollOnce — idempotency', () => {
  it('sends each transaction upsert with the same (source, source_id) conflict target', async () => {
    const fullQ = queueNames.syncFull('ynab');
    const { queues } = makeQueues({
      claim: {
        queue: fullQ,
        msg: {
          messageId: 99,
          readCount: 1,
          enqueuedAt: 'x',
          vt: 'x',
          payload: envelope('sync.ynab.full'),
        },
      },
    });
    const provider = makeProvider({
      accounts: [{ sourceId: 'y-a1', kind: 'checking', balanceCents: 0 }],
      txPages: asyncIterable([
        { transactions: [tx('t1', 'y-a1', -100)] },
        { transactions: [tx('t1', 'y-a1', -100)], nextCursor: 'st' },
      ]),
    });
    const { supabase, transactionUpserts } = makeSupabase({
      connection: CONNECTION,
      accountUpsertRows: [{ id: 'db-a1', external_id: 'y-a1' }],
      transactionUpsertRows: [{ id: 'db-t1', source_id: 't1' }],
    });
    await pollOnce({
      supabase: supabase as never,
      queues,
      providerFor: () => provider,
      log: makeLog(),
      ingestionEnabled: true,
      now: () => new Date('2026-04-20T12:00:00.000Z'),
    });
    // Two pages → two upsert calls with the same source_id; re-running
    // collapses to the same row via the unique index.
    expect(transactionUpserts).toHaveLength(2);
    expect(transactionUpserts[0]?.[0]).toMatchObject({ source: 'ynab', source_id: 't1' });
  });
});

// ---- Feature flag -----------------------------------------------------

describe('pollOnce — feature flag off', () => {
  it('does not write to app.* but still acks', async () => {
    const fullQ = queueNames.syncFull('ynab');
    const { queues, acks } = makeQueues({
      claim: {
        queue: fullQ,
        msg: {
          messageId: 55,
          readCount: 1,
          enqueuedAt: 'x',
          vt: 'x',
          payload: envelope('sync.ynab.full'),
        },
      },
    });
    const provider = makeProvider({
      accounts: [{ sourceId: 'y-a1', kind: 'checking', balanceCents: 100 }],
      txPages: asyncIterable([{ transactions: [tx('t1', 'y-a1', -100)], nextCursor: '1' }]),
    });
    const { supabase, accountUpserts, transactionUpserts, cursorUpserts } = makeSupabase({
      connection: CONNECTION,
    });
    await pollOnce({
      supabase: supabase as never,
      queues,
      providerFor: () => provider,
      log: makeLog(),
      ingestionEnabled: false,
      now: () => new Date('2026-04-20T12:00:00.000Z'),
    });
    expect(accountUpserts).toHaveLength(0);
    expect(transactionUpserts).toHaveLength(0);
    expect(cursorUpserts).toHaveLength(0);
    expect(acks).toEqual([{ queue: fullQ, id: 55 }]);
  });
});

// ---- Cron --------------------------------------------------------------

describe('runFinancialCron', () => {
  it('enqueues a sync_delta message for every active financial connection', async () => {
    const { supabase } = makeSupabase({
      connection: CONNECTION,
      activeConnections: [
        { id: 'c1', household_id: 'h1', provider: 'ynab', status: 'active' },
        { id: 'c2', household_id: 'h2', provider: 'ynab', status: 'active' },
      ],
    });
    const { queues, sends } = makeQueues();
    const result = await runFinancialCron({
      supabase: supabase as never,
      queues,
      log: makeLog(),
      now: () => new Date('2026-04-20T12:00:00.000Z'),
    });
    expect(result).toEqual({ enqueued: 2 });
    expect(sends).toHaveLength(2);
    expect(sends[0]?.queue).toBe(queueNames.syncDelta('ynab'));
    expect(sends[0]?.payload).toMatchObject({
      household_id: 'h1',
      kind: 'sync.ynab.delta',
      entity_id: 'c1',
    });
  });
});
