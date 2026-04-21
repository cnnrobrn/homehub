/**
 * Unit tests for the enrichment worker handler (M2-B).
 *
 * Strategy: stub Supabase, pgmq client, and an injected classifier. We
 * exercise three branches: happy path, missing row → DLQ, and
 * classifier-throws → DLQ. No network.
 */

import {
  DETERMINISTIC_CLASSIFIER_VERSION,
  type EventClassification,
  type EventClassifier,
} from '@homehub/enrichment';
import {
  type Logger,
  type MessageEnvelope,
  type QueueClient,
  queueNames,
} from '@homehub/worker-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { enrichOne, pollOnce } from './handler.js';

import type { Database } from '@homehub/db';

type EventRow = Database['app']['Tables']['event']['Row'];

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

function makeClassifier(result: EventClassification): EventClassifier {
  return {
    classify: vi.fn(() => result),
  } as unknown as EventClassifier;
}

function makeSupabase(opts: { row: EventRow | null; updateError?: string; auditError?: string }) {
  const eventUpdates: Array<Record<string, unknown>> = [];
  const auditInserts: Array<Record<string, unknown>> = [];
  const loadCalls: Array<{ id: string; household_id: string }> = [];

  const schemaApp = {
    from(table: string): unknown {
      if (table !== 'event') throw new Error(`unexpected app.${table}`);
      const eqFilters: Record<string, string> = {};
      return {
        select() {
          return this;
        },
        eq(col: string, val: string) {
          eqFilters[col] = val;
          return this;
        },
        maybeSingle: async () => {
          loadCalls.push({
            id: eqFilters.id ?? '',
            household_id: eqFilters.household_id ?? '',
          });
          return { data: opts.row, error: null };
        },
        update(payload: Record<string, unknown>) {
          eventUpdates.push(payload);
          return {
            eq(_col: string, _val: string) {
              if (opts.updateError) {
                return Promise.resolve({ data: null, error: { message: opts.updateError } });
              }
              return Promise.resolve({ data: null, error: null });
            },
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
          if (opts.auditError) {
            return { data: null, error: { message: opts.auditError } };
          }
          return { data: null, error: null };
        },
      };
    },
  };

  const supabase = {
    schema(name: string) {
      if (name === 'app') return schemaApp;
      if (name === 'audit') return schemaAudit;
      throw new Error(`unexpected schema ${name}`);
    },
  };

  return { supabase, eventUpdates, auditInserts, loadCalls };
}

function makeQueues(opts?: { claim?: unknown }) {
  const acks: Array<{ queue: string; id: number }> = [];
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
    nack: vi.fn(),
    send: vi.fn(),
    sendBatch: vi.fn(),
    deadLetter: vi.fn(async (queue, id, reason) => {
      deadLetters.push({ queue, id, reason });
    }),
    depth: vi.fn(),
    ageOfOldestSec: vi.fn(),
  } as unknown as QueueClient;

  return { queues, acks, deadLetters };
}

// ---- Fixtures ----------------------------------------------------------

const HOUSEHOLD_ID = 'a0000000-0000-4000-8000-000000000001';
const EVENT_ID = '10000000-0000-4000-8000-000000000001';

const BASE_ROW: EventRow = {
  id: EVENT_ID,
  household_id: HOUSEHOLD_ID,
  owner_member_id: null,
  segment: 'system',
  kind: 'calendar.event',
  title: 'Dinner reservation at Giulia',
  starts_at: '2026-04-25T23:00:00.000Z',
  ends_at: '2026-04-26T01:00:00.000Z',
  all_day: false,
  location: 'Giulia Restaurant',
  source_id: 'gcal-e1',
  source_version: '"v1"',
  provider: 'gcal',
  metadata: {
    owner_email: 'owner@example.com',
    attendees: [
      { email: 'owner@example.com', displayName: 'Owner' },
      { email: 'guest@example.com' },
    ],
    status: 'confirmed',
  },
  created_at: '2026-04-20T00:00:00.000Z',
  updated_at: '2026-04-20T00:00:00.000Z',
};

function envelope(): MessageEnvelope {
  return {
    household_id: HOUSEHOLD_ID,
    kind: 'enrich.event',
    entity_id: EVENT_ID,
    version: 1,
    enqueued_at: '2026-04-20T12:00:00.000Z',
  };
}

const FOOD_CLASSIFICATION: EventClassification = {
  segment: 'food',
  kind: 'reservation',
  confidence: 0.9,
  rationale: 'matched rule food.keyword.strong',
  signals: ['food.keyword.strong'],
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- Tests -------------------------------------------------------------

describe('enrichOne — happy path', () => {
  it('classifies, updates app.event, writes audit', async () => {
    const now = new Date('2026-04-20T12:34:00.000Z');
    const { supabase, eventUpdates, auditInserts, loadCalls } = makeSupabase({ row: BASE_ROW });
    const classifier = makeClassifier(FOOD_CLASSIFICATION);
    const { queues } = makeQueues();

    await enrichOne(
      {
        supabase: supabase as never,
        queues,
        log: makeLog(),
        classifier,
        now: () => now,
      },
      envelope(),
    );

    // Row lookup was scoped to household + id.
    expect(loadCalls).toEqual([{ id: EVENT_ID, household_id: HOUSEHOLD_ID }]);

    expect(eventUpdates).toHaveLength(1);
    const update = eventUpdates[0]!;
    expect(update.segment).toBe('food');
    expect(update.updated_at).toBe(now.toISOString());

    const metadata = update.metadata as Record<string, unknown>;
    expect(metadata.owner_email).toBe('owner@example.com');
    // Existing metadata is preserved.
    expect(metadata.status).toBe('confirmed');
    const enrichment = metadata.enrichment as Record<string, unknown>;
    expect(enrichment.segment).toBe('food');
    expect(enrichment.kind).toBe('reservation');
    expect(enrichment.confidence).toBe(0.9);
    expect(enrichment.signals).toEqual(['food.keyword.strong']);
    expect(enrichment.version).toBe(DETERMINISTIC_CLASSIFIER_VERSION);
    expect(enrichment.at).toBe(now.toISOString());

    expect(auditInserts).toHaveLength(1);
    const audit = auditInserts[0]!;
    expect(audit.action).toBe('event.enriched');
    expect(audit.resource_type).toBe('app.event');
    expect(audit.resource_id).toBe(EVENT_ID);
    expect(audit.household_id).toBe(HOUSEHOLD_ID);
    const before = audit.before as Record<string, unknown>;
    expect(before.segment).toBe('system');
    const after = audit.after as Record<string, unknown>;
    expect(after.segment).toBe('food');
  });
});

describe('pollOnce — idle when queue empty', () => {
  it('returns idle and does nothing', async () => {
    const { supabase } = makeSupabase({ row: BASE_ROW });
    const { queues, acks, deadLetters } = makeQueues();
    const result = await pollOnce({
      supabase: supabase as never,
      queues,
      log: makeLog(),
    });
    expect(result).toBe('idle');
    expect(acks).toEqual([]);
    expect(deadLetters).toEqual([]);
  });
});

describe('pollOnce — happy path with classifier', () => {
  it('claims, enriches, acks', async () => {
    const { supabase, eventUpdates } = makeSupabase({ row: BASE_ROW });
    const classifier = makeClassifier(FOOD_CLASSIFICATION);
    const { queues, acks, deadLetters } = makeQueues({
      claim: {
        queue: queueNames.enrichEvent,
        msg: {
          messageId: 101,
          readCount: 1,
          enqueuedAt: 'x',
          vt: 'x',
          payload: envelope(),
        },
      },
    });

    const result = await pollOnce({
      supabase: supabase as never,
      queues,
      log: makeLog(),
      classifier,
      now: () => new Date('2026-04-20T12:00:00.000Z'),
    });

    expect(result).toBe('claimed');
    expect(eventUpdates).toHaveLength(1);
    expect(acks).toEqual([{ queue: queueNames.enrichEvent, id: 101 }]);
    expect(deadLetters).toEqual([]);
  });
});

describe('pollOnce — missing row → DLQ', () => {
  it('dead-letters and acks when the event was deleted', async () => {
    const { supabase } = makeSupabase({ row: null });
    const { queues, acks, deadLetters } = makeQueues({
      claim: {
        queue: queueNames.enrichEvent,
        msg: {
          messageId: 202,
          readCount: 1,
          enqueuedAt: 'x',
          vt: 'x',
          payload: envelope(),
        },
      },
    });

    const result = await pollOnce({
      supabase: supabase as never,
      queues,
      log: makeLog(),
      classifier: makeClassifier(FOOD_CLASSIFICATION),
    });

    expect(result).toBe('claimed');
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0]?.reason).toMatch(/not found/);
    expect(acks).toEqual([{ queue: queueNames.enrichEvent, id: 202 }]);
  });
});

describe('pollOnce — update error → DLQ', () => {
  it('dead-letters when app.event update fails', async () => {
    const { supabase } = makeSupabase({ row: BASE_ROW, updateError: 'boom' });
    const { queues, acks, deadLetters } = makeQueues({
      claim: {
        queue: queueNames.enrichEvent,
        msg: {
          messageId: 303,
          readCount: 1,
          enqueuedAt: 'x',
          vt: 'x',
          payload: envelope(),
        },
      },
    });

    await pollOnce({
      supabase: supabase as never,
      queues,
      log: makeLog(),
      classifier: makeClassifier(FOOD_CLASSIFICATION),
    });

    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0]?.reason).toMatch(/boom/);
    expect(acks).toEqual([{ queue: queueNames.enrichEvent, id: 303 }]);
  });
});

describe('pollOnce — classifier throws → DLQ', () => {
  it('routes unexpected errors to the dead-letter queue and acks', async () => {
    const { supabase } = makeSupabase({ row: BASE_ROW });
    const throwingClassifier: EventClassifier = {
      classify: () => {
        throw new Error('classifier exploded');
      },
    };
    const { queues, acks, deadLetters } = makeQueues({
      claim: {
        queue: queueNames.enrichEvent,
        msg: {
          messageId: 404,
          readCount: 1,
          enqueuedAt: 'x',
          vt: 'x',
          payload: envelope(),
        },
      },
    });

    await pollOnce({
      supabase: supabase as never,
      queues,
      log: makeLog(),
      classifier: throwingClassifier,
    });

    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0]?.reason).toMatch(/classifier exploded/);
    expect(acks).toEqual([{ queue: queueNames.enrichEvent, id: 404 }]);
  });
});

describe('enrichOne — idempotent', () => {
  it('running twice produces the same final state', async () => {
    const now = new Date('2026-04-20T12:34:00.000Z');
    const rowAfterFirstRun: EventRow = {
      ...BASE_ROW,
      segment: 'food',
      metadata: {
        ...(typeof BASE_ROW.metadata === 'object' && BASE_ROW.metadata !== null
          ? BASE_ROW.metadata
          : {}),
        enrichment: {
          segment: 'food',
          kind: 'reservation',
          confidence: 0.9,
          rationale: 'matched rule food.keyword.strong',
          signals: ['food.keyword.strong'],
          version: DETERMINISTIC_CLASSIFIER_VERSION,
          at: now.toISOString(),
        },
      },
    };
    const { supabase, eventUpdates } = makeSupabase({ row: rowAfterFirstRun });
    const classifier = makeClassifier(FOOD_CLASSIFICATION);
    const { queues } = makeQueues();

    await enrichOne(
      {
        supabase: supabase as never,
        queues,
        log: makeLog(),
        classifier,
        now: () => now,
      },
      envelope(),
    );

    const update = eventUpdates[0]!;
    expect(update.segment).toBe('food');
    const metadata = update.metadata as Record<string, unknown>;
    const enrichment = metadata.enrichment as Record<string, unknown>;
    expect(enrichment.version).toBe(DETERMINISTIC_CLASSIFIER_VERSION);
    expect(enrichment.segment).toBe('food');
  });
});
