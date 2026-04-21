/**
 * Unit tests for the DLQ primitives.
 *
 * Supabase + pgmq are stubbed — the primitives are thin enough that the
 * tests focus on
 *   - filter composition (queue, householdId, limit),
 *   - household-scoped filtering via the joined provider_connection row,
 *   - replay validation (envelope shape, missing rows, enqueue errors),
 *   - purge idempotency.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  listDeadLetters,
  purgeDeadLetter,
  replayDeadLetter,
  type DlqQueueClient,
} from './primitives.js';

interface QueryState {
  table: string | null;
  schema: string | null;
  filters: Array<{ column: string; op: string; value: unknown }>;
  order: { column: string; ascending: boolean } | null;
  limitValue: number | null;
  single: boolean;
  op: 'select' | 'delete' | null;
}

type StubResponse = { data: unknown; error: { message: string } | null };

function createStub(responseByTable: Record<string, StubResponse | (() => StubResponse)>) {
  const state: QueryState = {
    table: null,
    schema: null,
    filters: [],
    order: null,
    limitValue: null,
    single: false,
    op: null,
  };

  const chain = {
    select(_cols: string) {
      state.op = 'select';
      return chain;
    },
    eq(column: string, value: unknown) {
      state.filters.push({ column, op: 'eq', value });
      return chain;
    },
    order(column: string, opts: { ascending: boolean }) {
      state.order = { column, ascending: opts.ascending };
      return chain;
    },
    limit(n: number) {
      state.limitValue = n;
      return chain;
    },
    maybeSingle() {
      state.single = true;
      return Promise.resolve(settle());
    },
    delete() {
      state.op = 'delete';
      return chain;
    },
    // Terminal `then` — awaiting the chain resolves the query.
    then(onFulfilled: (value: StubResponse) => unknown, onRejected?: (reason: unknown) => unknown) {
      try {
        return Promise.resolve(settle()).then(onFulfilled, onRejected);
      } catch (err) {
        if (onRejected) return Promise.resolve(onRejected(err));
        throw err;
      }
    },
  };

  function settle(): StubResponse {
    if (!state.table) {
      throw new Error('stub: no table selected');
    }
    const raw = responseByTable[state.table];
    if (!raw) {
      throw new Error(`stub: no response registered for table ${state.table}`);
    }
    return typeof raw === 'function' ? raw() : raw;
  }

  const api = {
    schema(name: string) {
      state.schema = name;
      return {
        from(table: string) {
          state.table = table;
          return chain;
        },
      };
    },
    __state: state,
  };

  return { client: api as unknown as Parameters<typeof listDeadLetters>[0], state };
}

describe('listDeadLetters', () => {
  it('returns entries in received_at DESC order with default limit', async () => {
    const { client, state } = createStub({
      dead_letter: {
        data: [
          {
            id: 'a',
            connection_id: null,
            queue: 'enrich_event',
            message_id: 10,
            payload: { kind: 'test' },
            error: 'boom',
            received_at: '2026-04-20T00:00:00Z',
            connection: null,
          },
        ],
        error: null,
      },
    });

    const result = await listDeadLetters(client);
    expect(result).toHaveLength(1);
    expect(result[0]?.queue).toBe('enrich_event');
    expect(result[0]?.householdId).toBeNull();
    expect(state.order).toEqual({ column: 'received_at', ascending: false });
    expect(state.limitValue).toBe(100);
  });

  it('applies queue filter', async () => {
    const { client, state } = createStub({
      dead_letter: { data: [], error: null },
    });
    await listDeadLetters(client, { queue: 'enrich_email' });
    expect(state.filters).toContainEqual({ column: 'queue', op: 'eq', value: 'enrich_email' });
  });

  it('filters by household id using the joined connection row', async () => {
    const target = '11111111-1111-4111-8111-111111111111';
    const other = '22222222-2222-4222-8222-222222222222';
    const { client } = createStub({
      dead_letter: {
        data: [
          {
            id: 'a',
            connection_id: 'c1',
            queue: 'q',
            message_id: 1,
            payload: {},
            error: 'e',
            received_at: '2026-04-20T00:00:00Z',
            connection: { household_id: target },
          },
          {
            id: 'b',
            connection_id: 'c2',
            queue: 'q',
            message_id: 2,
            payload: {},
            error: 'e',
            received_at: '2026-04-19T00:00:00Z',
            connection: { household_id: other },
          },
          {
            id: 'c',
            connection_id: null,
            queue: 'q',
            message_id: null,
            payload: {},
            error: 'e',
            received_at: '2026-04-18T00:00:00Z',
            connection: null,
          },
        ],
        error: null,
      },
    });

    const result = await listDeadLetters(client, { householdId: target });
    expect(result.map((r) => r.id)).toEqual(['a']);
  });

  it('rejects an over-large limit', async () => {
    const { client } = createStub({ dead_letter: { data: [], error: null } });
    await expect(listDeadLetters(client, { limit: 1000 })).rejects.toThrow();
  });

  it('throws on supabase error', async () => {
    const { client } = createStub({
      dead_letter: { data: null, error: { message: 'nope' } },
    });
    await expect(listDeadLetters(client)).rejects.toThrow(/nope/);
  });
});

describe('replayDeadLetter', () => {
  const validEnvelope = {
    household_id: '11111111-1111-4111-8111-111111111111',
    kind: 'enrich.event',
    entity_id: '22222222-2222-4222-8222-222222222222',
    version: 1,
    enqueued_at: '2026-04-20T00:00:00+00:00',
  };

  it('re-sends the stored envelope to its queue', async () => {
    const { client } = createStub({
      dead_letter: {
        data: { id: 'x', queue: 'enrich_event', payload: validEnvelope },
        error: null,
      },
    });
    const queues: DlqQueueClient = { send: vi.fn().mockResolvedValue(42) };
    const result = await replayDeadLetter(client, queues, 'x');
    expect(result.enqueued).toBe(true);
    expect(queues.send).toHaveBeenCalledWith('enrich_event', validEnvelope);
  });

  it('returns a friendly reason when the row is missing', async () => {
    const { client } = createStub({
      dead_letter: { data: null, error: null },
    });
    const queues: DlqQueueClient = { send: vi.fn() };
    const result = await replayDeadLetter(client, queues, 'missing');
    expect(result.enqueued).toBe(false);
    expect(result.reason).toMatch(/not found/);
    expect(queues.send).not.toHaveBeenCalled();
  });

  it('returns a friendly reason when the payload is malformed', async () => {
    const { client } = createStub({
      dead_letter: {
        data: { id: 'x', queue: 'q', payload: { not: 'an envelope' } },
        error: null,
      },
    });
    const queues: DlqQueueClient = { send: vi.fn() };
    const result = await replayDeadLetter(client, queues, 'x');
    expect(result.enqueued).toBe(false);
    expect(result.reason).toMatch(/envelope/i);
  });

  it('returns a friendly reason when enqueue fails', async () => {
    const { client } = createStub({
      dead_letter: {
        data: { id: 'x', queue: 'q', payload: validEnvelope },
        error: null,
      },
    });
    const queues: DlqQueueClient = {
      send: vi.fn().mockRejectedValue(new Error('pgmq unavailable')),
    };
    const result = await replayDeadLetter(client, queues, 'x');
    expect(result.enqueued).toBe(false);
    expect(result.reason).toMatch(/pgmq unavailable/);
  });
});

describe('purgeDeadLetter', () => {
  it('issues a delete by id', async () => {
    const { client, state } = createStub({
      dead_letter: { data: null, error: null },
    });
    await purgeDeadLetter(client, 'abc');
    expect(state.op).toBe('delete');
    expect(state.filters).toContainEqual({ column: 'id', op: 'eq', value: 'abc' });
  });

  it('throws on supabase error', async () => {
    const { client } = createStub({
      dead_letter: { data: null, error: { message: 'rls' } },
    });
    await expect(purgeDeadLetter(client, 'abc')).rejects.toThrow(/rls/);
  });
});
