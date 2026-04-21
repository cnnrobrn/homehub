/**
 * Unit tests for the sync-gcal handler.
 *
 * Strategy: stub every external — Supabase (schema/from/select/upsert),
 * the QueueClient, and the CalendarProvider. We don't hit any real
 * network or database.
 */

import {
  type CalendarEvent,
  type CalendarProvider,
  FullResyncRequiredError,
  RateLimitError,
} from '@homehub/providers-calendar';
import { type QueueClient, type Logger, queueNames } from '@homehub/worker-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CURSOR_KIND, EVENT_PROVIDER, pollOnce } from './handler.js';

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

function makeCalendar(
  pages: AsyncIterable<{ events: CalendarEvent[]; nextSyncToken?: string }>,
): CalendarProvider {
  return {
    listEvents: () => pages,
    watch: vi.fn(),
    unwatch: vi.fn(),
  } as unknown as CalendarProvider;
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

interface ConnectionRow {
  id: string;
  household_id: string;
  member_id: string | null;
  provider: string;
  nango_connection_id: string;
  status: string;
}

function makeSupabase(opts: {
  connection: ConnectionRow;
  cursorValue?: string;
  upsertRows?: Array<{ id: string; source_id: string }>;
}) {
  const cursorUpserts: Array<Record<string, unknown>> = [];
  const cursorDeletes: Array<Record<string, unknown>> = [];
  const eventUpserts: Array<Record<string, unknown>[]> = [];
  const connectionUpdates: Array<Record<string, unknown>> = [];
  const auditInserts: Array<Record<string, unknown>> = [];

  const schemaSync = {
    from(table: string): unknown {
      if (table === 'provider_connection') {
        const state = { type: 'select' as 'select' | 'update' };
        return {
          select() {
            state.type = 'select';
            return this;
          },
          eq: function () {
            return this;
          },
          maybeSingle: async () => ({ data: opts.connection, error: null }),
          update(payload: Record<string, unknown>) {
            connectionUpdates.push(payload);
            state.type = 'update';
            return {
              eq: async () => ({ data: null, error: null }),
            };
          },
        };
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
            if (whereKind === CURSOR_KIND.syncToken && opts.cursorValue) {
              return {
                data: { kind: CURSOR_KIND.syncToken, value: opts.cursorValue },
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
              eq: function () {
                cursorDeletes.push({});
                // Return the same chain so `.eq().eq()` composes. Once
                // the caller awaits, the chain's `then` resolves.
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
      if (table !== 'event') throw new Error(`unexpected app.${table}`);
      return {
        upsert(rows: Record<string, unknown>[]) {
          eventUpserts.push(rows);
          return {
            select: async () => ({ data: opts.upsertRows ?? [], error: null }),
          };
        },
      };
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

  return { supabase, cursorUpserts, cursorDeletes, eventUpserts, connectionUpdates, auditInserts };
}

function makeQueues(opts?: { claim?: unknown }) {
  const acks: Array<{ queue: string; id: number }> = [];
  const nacks: Array<{ queue: string; id: number; retryDelaySec?: number }> = [];
  const sends: Array<{ queue: string; payload: unknown }> = [];
  const batchSends: Array<{ queue: string; payloads: unknown[] }> = [];
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
    sendBatch: vi.fn(async (queue, payloads) => {
      batchSends.push({ queue, payloads });
      return payloads.map((_p: unknown, i: number) => i + 1);
    }),
    deadLetter: vi.fn(async (queue, id, reason) => {
      deadLetters.push({ queue, id, reason });
    }),
    depth: vi.fn(),
    ageOfOldestSec: vi.fn(),
  } as unknown as QueueClient;

  return { queues, acks, nacks, sends, batchSends, deadLetters };
}

const CONNECTION_ID = 'c0000000-0000-4000-8000-000000000001';
const HOUSEHOLD_ID = 'a0000000-0000-4000-8000-000000000001';
const MEMBER_ID = 'b0000000-0000-4000-8000-000000000001';
const EVENT_ID_1 = '10000000-0000-4000-8000-000000000001';
const EVENT_ID_2 = '10000000-0000-4000-8000-000000000002';

const CONNECTION: ConnectionRow = {
  id: CONNECTION_ID,
  household_id: HOUSEHOLD_ID,
  member_id: MEMBER_ID,
  provider: EVENT_PROVIDER,
  nango_connection_id: 'nango-abc',
  status: 'active',
};

function envelope(kind: 'sync.gcal.full' | 'sync.gcal.delta') {
  return {
    household_id: HOUSEHOLD_ID,
    kind,
    entity_id: CONNECTION_ID,
    version: 1,
    enqueued_at: '2026-04-20T12:00:00.000Z',
  };
}

function evt(id: string, title: string): CalendarEvent {
  return {
    sourceId: id,
    sourceVersion: '"e"',
    title,
    startsAt: '2026-04-20T14:00:00.000Z',
    endsAt: '2026-04-20T15:00:00.000Z',
    allDay: false,
    attendees: [],
    ownerEmail: 'o@example.com',
    status: 'confirmed',
    metadata: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('pollOnce — happy path (sync_full)', () => {
  it('upserts two events, enqueues enrichment, writes cursor, ack', async () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const pages = asyncIterable([
      {
        events: [evt('e1', 'Standup'), evt('e2', 'Lunch')],
        nextSyncToken: 'st-new',
      },
    ]);

    const fullQ = queueNames.syncFull('gcal');
    const { queues, acks, batchSends } = makeQueues({
      claim: {
        queue: fullQ,
        msg: {
          messageId: 42,
          readCount: 1,
          enqueuedAt: '2026-04-20T11:59:00Z',
          vt: 'now',
          payload: envelope('sync.gcal.full'),
        },
      },
    });

    const { supabase, cursorUpserts, eventUpserts, connectionUpdates, auditInserts } = makeSupabase(
      {
        connection: CONNECTION,
        upsertRows: [
          { id: EVENT_ID_1, source_id: 'e1' },
          { id: EVENT_ID_2, source_id: 'e2' },
        ],
      },
    );

    const result = await pollOnce({
      supabase: supabase as never,
      queues,
      calendar: makeCalendar(pages),
      log: makeLog(),
      now: () => now,
    });

    expect(result).toBe('claimed');
    expect(eventUpserts[0]).toHaveLength(2);
    expect(batchSends[0]?.queue).toBe(queueNames.enrichEvent);
    expect(batchSends[0]?.payloads).toHaveLength(2);
    expect(cursorUpserts).toHaveLength(1);
    expect(cursorUpserts[0]).toMatchObject({ value: 'st-new', kind: CURSOR_KIND.syncToken });
    expect(connectionUpdates).toHaveLength(1);
    expect(auditInserts[0]).toMatchObject({ action: 'sync.gcal.full.completed' });
    expect(acks).toEqual([{ queue: fullQ, id: 42 }]);
  });
});

describe('pollOnce — FullResyncRequired', () => {
  it('requeues as sync_full and acks the original delta', async () => {
    const deltaQ = queueNames.syncDelta('gcal');
    const fullQ = queueNames.syncFull('gcal');
    const { queues, acks, sends } = makeQueues({
      claim: {
        queue: deltaQ,
        msg: {
          messageId: 7,
          readCount: 1,
          enqueuedAt: 'x',
          vt: 'x',
          payload: envelope('sync.gcal.delta'),
        },
      },
    });

    const { supabase, cursorDeletes, eventUpserts } = makeSupabase({
      connection: CONNECTION,
      cursorValue: 'st-old',
    });

    const pages = throwingIterable(new FullResyncRequiredError('410'));
    const result = await pollOnce({
      supabase: supabase as never,
      queues,
      calendar: makeCalendar(pages),
      log: makeLog(),
    });

    expect(result).toBe('claimed');
    // No rows upserted. No cursor written.
    expect(eventUpserts).toHaveLength(0);
    // Cursor cleared.
    expect(cursorDeletes.length).toBeGreaterThan(0);
    // Re-enqueued as full.
    expect(sends[0]?.queue).toBe(fullQ);
    expect(sends[0]?.payload).toMatchObject({ kind: 'sync.gcal.full' });
    // Original message ack'd (not nack'd, not dead-lettered).
    expect(acks).toEqual([{ queue: deltaQ, id: 7 }]);
  });
});

describe('pollOnce — RateLimitError', () => {
  it('nacks with the retry-after delay', async () => {
    const deltaQ = queueNames.syncDelta('gcal');
    const { queues, nacks, acks } = makeQueues({
      claim: {
        queue: deltaQ,
        msg: {
          messageId: 9,
          readCount: 1,
          enqueuedAt: 'x',
          vt: 'x',
          payload: envelope('sync.gcal.delta'),
        },
      },
    });
    const { supabase } = makeSupabase({ connection: CONNECTION, cursorValue: 'st' });
    const pages = throwingIterable(new RateLimitError('429', 73));
    const result = await pollOnce({
      supabase: supabase as never,
      queues,
      calendar: makeCalendar(pages),
      log: makeLog(),
    });
    expect(result).toBe('claimed');
    expect(nacks).toEqual([{ queue: deltaQ, id: 9, retryDelaySec: 73 }]);
    expect(acks).toEqual([]);
  });
});

describe('pollOnce — terminal failure', () => {
  it('dead-letters and acks', async () => {
    const fullQ = queueNames.syncFull('gcal');
    const { queues, deadLetters, acks } = makeQueues({
      claim: {
        queue: fullQ,
        msg: {
          messageId: 13,
          readCount: 1,
          enqueuedAt: 'x',
          vt: 'x',
          payload: envelope('sync.gcal.full'),
        },
      },
    });
    const { supabase } = makeSupabase({ connection: CONNECTION });
    const pages = throwingIterable(new Error('boom'));
    const result = await pollOnce({
      supabase: supabase as never,
      queues,
      calendar: makeCalendar(pages),
      log: makeLog(),
    });
    expect(result).toBe('claimed');
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0]?.reason).toMatch(/boom/);
    expect(acks).toEqual([{ queue: fullQ, id: 13 }]);
  });
});

describe('pollOnce — idempotency', () => {
  it('two pages with the same events still write a single upsert batch per page', async () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const fullQ = queueNames.syncFull('gcal');
    const { queues } = makeQueues({
      claim: {
        queue: fullQ,
        msg: {
          messageId: 99,
          readCount: 1,
          enqueuedAt: 'x',
          vt: 'x',
          payload: envelope('sync.gcal.full'),
        },
      },
    });
    const pages = asyncIterable([
      { events: [evt('e1', 'Run once')] },
      { events: [evt('e1', 'Run twice')], nextSyncToken: 'st' },
    ]);
    const { supabase, eventUpserts } = makeSupabase({
      connection: CONNECTION,
      upsertRows: [{ id: EVENT_ID_1, source_id: 'e1' }],
    });
    await pollOnce({
      supabase: supabase as never,
      queues,
      calendar: makeCalendar(pages),
      log: makeLog(),
      now: () => now,
    });
    // Two pages → two upsert calls, each with the expected onConflict key.
    expect(eventUpserts).toHaveLength(2);
    expect(eventUpserts[0]?.[0]).toMatchObject({
      provider: EVENT_PROVIDER,
      source_id: 'e1',
      segment: 'system',
    });
  });
});
