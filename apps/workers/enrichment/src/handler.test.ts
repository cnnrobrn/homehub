/**
 * Unit tests for the M3-B enrichment worker handler.
 *
 * Strategy: stub Supabase, pgmq client, and inject a precomputed
 * `pipeline` (so the worker doesn't need a model client). We cover:
 *
 *   - Happy path (classification writes segment + metadata, no
 *     extraction): worker falls back to deterministic path when the
 *     pipeline yields `source='deterministic'`.
 *   - Missing row → DLQ.
 *   - Update error → DLQ.
 *   - Full extraction path: the stubbed pipeline returns an episode +
 *     a fact; the worker resolves nodes, inserts the candidate, runs
 *     the reconciler (stubbed via short-circuit here), and enqueues
 *     node_regen.
 */

import {
  DETERMINISTIC_CLASSIFIER_VERSION,
  type EnrichmentPipeline,
  type EventClassification,
  type ExtractionResult,
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

function makePipeline(opts: {
  classification: EventClassification;
  source: 'model' | 'deterministic';
  extraction?: ExtractionResult;
  extractionRan?: boolean;
  extractionReason?: 'ok' | 'budget_exceeded' | 'degraded_skipped' | 'model_error';
}): EnrichmentPipeline {
  return {
    classify: vi.fn(async () => ({
      classification: opts.classification,
      source: opts.source,
      budget: { ok: true, tier: 'default' },
    })),
    extract: vi.fn(async () => ({
      extraction: opts.extraction ?? { episodes: [], facts: [] },
      ran: opts.extractionRan ?? false,
      reason: opts.extractionReason ?? 'ok',
      budget: { ok: true, tier: 'default' },
    })),
  } as unknown as EnrichmentPipeline;
}

interface SupabaseState {
  eventRow: EventRow | null;
  updateError?: string;
  /** Returned canonical nodes for resolver queries. */
  nodes: Array<{ id: string; canonical_name: string; type: string; household_id: string }>;
  episodeInserts: Array<Record<string, unknown>>;
  nodeInserts: Array<Record<string, unknown>>;
  candidateInserts: Array<Record<string, unknown>>;
  eventUpdates: Array<Record<string, unknown>>;
  auditInserts: Array<Record<string, unknown>>;
  factCandidates: Map<string, Record<string, unknown>>;
  facts: Map<string, Record<string, unknown>>;
  modelCalls: Array<Record<string, unknown>>;
}

function makeSupabase(init: Partial<SupabaseState> = {}) {
  const state: SupabaseState = {
    eventRow: init.eventRow ?? null,
    ...(init.updateError !== undefined ? { updateError: init.updateError } : {}),
    nodes: init.nodes ?? [],
    episodeInserts: [],
    nodeInserts: [],
    candidateInserts: [],
    eventUpdates: [],
    auditInserts: [],
    factCandidates: new Map(),
    facts: new Map(),
    modelCalls: [],
  };

  let candidateId = 1;
  let nodeId = 1;

  function appSchema(table: string) {
    if (table === 'event') {
      const filters: Record<string, string> = {};
      let mode: 'select' | 'update' = 'select';
      const chain: Record<string, unknown> = {
        select() {
          mode = 'select';
          return chain;
        },
        update(payload: Record<string, unknown>) {
          mode = 'update';
          state.eventUpdates.push(payload);
          return chain;
        },
        eq(col: string, val: string) {
          filters[col] = val;
          if (mode === 'update') {
            if (state.updateError) {
              return Promise.resolve({ data: null, error: { message: state.updateError } });
            }
            return Promise.resolve({ data: null, error: null });
          }
          return chain;
        },
        async maybeSingle() {
          return { data: state.eventRow, error: null };
        },
      };
      return chain;
    }
    if (table === 'model_calls') {
      return {
        insert(row: Record<string, unknown>) {
          state.modelCalls.push(row);
          return Promise.resolve({ data: null, error: null });
        },
      };
    }
    if (table === 'household') {
      // For withBudgetGuard inside enrichOne; return no settings →
      // unlimited budget.
      return {
        select() {
          return this;
        },
        eq(_c: string, _v: string) {
          return this;
        },
        async maybeSingle() {
          return { data: { settings: {} }, error: null };
        },
      };
    }
    throw new Error(`unexpected app.${table}`);
  }

  function memSchema(table: string) {
    if (table === 'node') {
      const filters: Record<string, unknown> = {};
      let ilikePattern: { col: string; val: string } | null = null;
      let insertPayload: Record<string, unknown> | undefined;
      let selectCols: string | undefined;
      let limit: number | undefined;

      const chain: Record<string, unknown> = {
        select(cols?: string) {
          selectCols = cols;
          return chain;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return chain;
        },
        ilike(col: string, val: string) {
          ilikePattern = { col, val };
          return chain;
        },
        limit(n: number) {
          limit = n;
          return chain;
        },
        insert(payload: Record<string, unknown>) {
          insertPayload = payload;
          state.nodeInserts.push(payload);
          return chain;
        },
        single() {
          const id = `node-${nodeId++}`;
          state.nodes.push({
            id,
            canonical_name: insertPayload!.canonical_name as string,
            type: insertPayload!.type as string,
            household_id: insertPayload!.household_id as string,
          });
          return Promise.resolve({ data: { id }, error: null });
        },
        update(_p: Record<string, unknown>) {
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
      };

      (chain as Record<string, unknown>).then = (fulfill: (v: unknown) => unknown) => {
        // select case: find matching node
        let rows = state.nodes.slice();
        for (const [k, v] of Object.entries(filters)) {
          rows = rows.filter((r) => (r as Record<string, unknown>)[k] === v);
        }
        if (ilikePattern) {
          const target = ilikePattern.val.toLowerCase();
          rows = rows.filter(
            (r) =>
              ((r as Record<string, unknown>)[ilikePattern!.col] as string).toLowerCase() ===
              target,
          );
        }
        if (limit != null) rows = rows.slice(0, limit);
        // Only return `id` field when select asked for it.
        const projected =
          selectCols && selectCols.includes('canonical_name')
            ? rows.map((r) => ({ id: r.id, canonical_name: r.canonical_name }))
            : rows.map((r) => ({ id: r.id }));
        return Promise.resolve(fulfill({ data: projected, error: null }));
      };

      return chain;
    }
    if (table === 'alias') {
      // Always empty.
      const chain: Record<string, unknown> = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        ilike() {
          return chain;
        },
        limit() {
          return chain;
        },
      };
      (chain as Record<string, unknown>).then = (fulfill: (v: unknown) => unknown) => {
        return Promise.resolve(fulfill({ data: [], error: null }));
      };
      return chain;
    }
    if (table === 'fact_candidate') {
      let insertPayload: Record<string, unknown> | undefined;
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        insert(p: Record<string, unknown>) {
          insertPayload = p;
          state.candidateInserts.push(p);
          return chain;
        },
        select() {
          return chain;
        },
        async single() {
          const id = `cand-${candidateId++}`;
          const row = { id, ...(insertPayload as object), status: 'pending' };
          state.factCandidates.set(id, row);
          return { data: { id }, error: null };
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return chain;
        },
        update(p: Record<string, unknown>) {
          const id = filters.id as string;
          const current = state.factCandidates.get(id);
          if (current) {
            state.factCandidates.set(id, { ...current, ...p });
          }
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
        async maybeSingle() {
          const id = filters.id as string;
          return { data: state.factCandidates.get(id) ?? null, error: null };
        },
      };
      return chain;
    }
    if (table === 'fact') {
      const filters: Record<string, unknown> = {};
      let mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
      let insertPayload: Record<string, unknown> | undefined;
      let limit: number | undefined;
      const chain: Record<string, unknown> = {
        select() {
          mode = 'select';
          return chain;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          if (mode === 'update') {
            return Promise.resolve({ data: null, error: null });
          }
          if (mode === 'delete') {
            state.facts.delete(filters.id as string);
            return Promise.resolve({ data: null, error: null });
          }
          return chain;
        },
        is(col: string, val: unknown) {
          filters[col] = val;
          return chain;
        },
        limit(n: number) {
          limit = n;
          return chain;
        },
        insert(p: Record<string, unknown>) {
          mode = 'insert';
          insertPayload = p;
          return chain;
        },
        async single() {
          const id = `fact-${candidateId++}`;
          state.facts.set(id, { id, ...(insertPayload as object) });
          return { data: { id }, error: null };
        },
        update() {
          mode = 'update';
          return chain;
        },
        delete() {
          mode = 'delete';
          return chain;
        },
      };
      (chain as Record<string, unknown>).then = (fulfill: (v: unknown) => unknown) => {
        let rows = Array.from(state.facts.values());
        for (const [k, v] of Object.entries(filters)) {
          rows = rows.filter((r) => {
            if (v === null) return (r as Record<string, unknown>)[k] === null;
            return (r as Record<string, unknown>)[k] === v;
          });
        }
        if (limit != null) rows = rows.slice(0, limit);
        return Promise.resolve(fulfill({ data: rows, error: null }));
      };
      return chain;
    }
    if (table === 'episode') {
      return {
        insert(p: Record<string, unknown>) {
          state.episodeInserts.push(p);
          return Promise.resolve({ data: null, error: null });
        },
      };
    }
    throw new Error(`unexpected mem.${table}`);
  }

  function auditSchema(table: string) {
    if (table !== 'event') throw new Error(`unexpected audit.${table}`);
    return {
      insert(row: Record<string, unknown>) {
        state.auditInserts.push(row);
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  const supabase = {
    schema(name: string) {
      if (name === 'app') {
        return { from: (t: string) => appSchema(t) };
      }
      if (name === 'mem') {
        return { from: (t: string) => memSchema(t) };
      }
      if (name === 'audit') {
        return { from: (t: string) => auditSchema(t) };
      }
      throw new Error(`unexpected schema ${name}`);
    },
  };

  return { supabase, state };
}

function makeQueues(opts?: { claim?: unknown }) {
  const acks: Array<{ queue: string; id: number }> = [];
  const deadLetters: Array<{ queue: string; id: number; reason: string }> = [];
  const sent: Array<{ queue: string; payload: MessageEnvelope }> = [];

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
    send: vi.fn(async (queue, payload) => {
      sent.push({ queue, payload });
      return 1;
    }),
    sendBatch: vi.fn(),
    deadLetter: vi.fn(async (queue, id, reason) => {
      deadLetters.push({ queue, id, reason });
    }),
    depth: vi.fn(),
    ageOfOldestSec: vi.fn(),
  } as unknown as QueueClient;

  return { queues, acks, deadLetters, sent };
}

// ---- Fixtures ---------------------------------------------------------

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

const FOOD: EventClassification = {
  segment: 'food',
  kind: 'reservation',
  confidence: 0.9,
  rationale: 'rule fired',
  signals: ['food.keyword.strong'],
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

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- Tests ------------------------------------------------------------

describe('enrichOne — deterministic-only happy path', () => {
  it('classifies, updates app.event, writes audit — no extraction', async () => {
    const now = new Date('2026-04-20T12:34:00Z');
    const { supabase, state } = makeSupabase({ eventRow: BASE_ROW });
    const pipeline = makePipeline({ classification: FOOD, source: 'deterministic' });
    const { queues, sent } = makeQueues();

    await enrichOne(
      {
        supabase: supabase as never,
        queues,
        log: makeLog(),
        pipeline,
        now: () => now,
      },
      envelope(),
    );

    expect(state.eventUpdates).toHaveLength(1);
    const update = state.eventUpdates[0]!;
    expect(update.segment).toBe('food');
    const metadata = update.metadata as Record<string, unknown>;
    const enrichment = metadata.enrichment as Record<string, unknown>;
    expect(enrichment.version).toBe(DETERMINISTIC_CLASSIFIER_VERSION);
    expect(enrichment.source).toBe('deterministic');

    expect(state.candidateInserts).toHaveLength(0);
    expect(state.episodeInserts).toHaveLength(0);
    expect(sent).toHaveLength(0);

    expect(state.auditInserts).toHaveLength(1);
    const audit = state.auditInserts[0]!;
    expect(audit.action).toBe('event.enriched');
  });
});

describe('enrichOne — model path with extraction', () => {
  it('writes episodes, candidates, reconciles, and enqueues node_regen', async () => {
    const now = new Date('2026-04-20T12:34:00Z');
    const { supabase, state } = makeSupabase({
      eventRow: BASE_ROW,
      nodes: [
        {
          id: 'sarah-id',
          canonical_name: 'Sarah',
          type: 'person',
          household_id: HOUSEHOLD_ID,
        },
      ],
    });
    const pipeline = makePipeline({
      classification: FOOD,
      source: 'model',
      extractionRan: true,
      extractionReason: 'ok',
      extraction: {
        episodes: [
          {
            occurred_at: '2026-04-25T23:00:00Z',
            title: 'Dinner',
            summary: 'Dinner at Giulia',
            participants: ['person:Sarah'],
            place_reference: 'place:Giulia',
            mentions_facts: ['f_001'],
          },
        ],
        facts: [
          {
            id: 'f_001',
            subject: 'person:Sarah',
            predicate: 'is',
            object_value: 'vegetarian',
            confidence: 0.85,
            evidence: 'chose vegetarian option',
            valid_from: 'inferred',
          },
        ],
      },
    });
    const { queues, sent } = makeQueues();

    await enrichOne(
      {
        supabase: supabase as never,
        queues,
        log: makeLog(),
        pipeline,
        // Simulate that a model client exists so the worker enters
        // the extraction path.
        modelClient: {
          generate: async () => ({}) as never,
          embed: async () => ({}) as never,
        } as never,
        now: () => now,
      },
      envelope(),
    );

    // Classified.
    expect(state.eventUpdates).toHaveLength(1);
    const enrichment = (state.eventUpdates[0]!.metadata as Record<string, unknown>)
      .enrichment as Record<string, unknown>;
    expect(enrichment.source).toBe('model');

    // One candidate inserted.
    expect(state.candidateInserts).toHaveLength(1);
    const candIns = state.candidateInserts[0]!;
    expect(candIns.predicate).toBe('is');
    expect(candIns.subject_node_id).toBe('sarah-id');
    expect(candIns.status).toBe('pending');

    // One episode inserted.
    expect(state.episodeInserts).toHaveLength(1);
    const ep = state.episodeInserts[0]!;
    expect(ep.participants).toEqual(['sarah-id']);
    expect(ep.source_type).toBe('event');
    expect(ep.source_id).toBe(EVENT_ID);

    // A place node was created (Giulia wasn't in nodes seed).
    expect(state.nodeInserts.some((n) => n.type === 'place')).toBe(true);

    // Reconciler promoted the candidate to a canonical fact.
    // (Our fake supabase uses `is` predicate with no existing canonical,
    // so the candidate promotes when confidence >= threshold.)
    // node_regen enqueued for at least the subject; embed_node enqueued
    // for any newly-created nodes.
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.some((s) => s.queue === queueNames.nodeRegen)).toBe(true);
    expect(
      sent.every((s) => s.queue === queueNames.nodeRegen || s.queue === queueNames.embedNode),
    ).toBe(true);
    // The newly-created place node (Giulia) must be enqueued for embedding.
    expect(sent.some((s) => s.queue === queueNames.embedNode)).toBe(true);

    // Audit action upgraded to mem.event.enriched.
    expect(state.auditInserts).toHaveLength(1);
    expect(state.auditInserts[0]!.action).toBe('mem.event.enriched');
  });
});

describe('pollOnce — idle', () => {
  it('returns idle when the queue is empty', async () => {
    const { supabase } = makeSupabase({ eventRow: BASE_ROW });
    const { queues, acks, deadLetters } = makeQueues();
    const pipeline = makePipeline({ classification: FOOD, source: 'deterministic' });
    const result = await pollOnce({
      supabase: supabase as never,
      queues,
      log: makeLog(),
      pipeline,
    });
    expect(result).toBe('idle');
    expect(acks).toEqual([]);
    expect(deadLetters).toEqual([]);
  });
});

describe('pollOnce — missing row → DLQ', () => {
  it('dead-letters and acks', async () => {
    const { supabase } = makeSupabase({ eventRow: null });
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
    const pipeline = makePipeline({ classification: FOOD, source: 'deterministic' });

    await pollOnce({
      supabase: supabase as never,
      queues,
      log: makeLog(),
      pipeline,
    });
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0]?.reason).toMatch(/not found/);
    expect(acks).toEqual([{ queue: queueNames.enrichEvent, id: 202 }]);
  });
});

describe('pollOnce — update error → DLQ', () => {
  it('dead-letters when app.event update fails', async () => {
    const { supabase } = makeSupabase({
      eventRow: BASE_ROW,
      updateError: 'boom',
    });
    const { queues, deadLetters } = makeQueues({
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
    const pipeline = makePipeline({ classification: FOOD, source: 'deterministic' });

    await pollOnce({
      supabase: supabase as never,
      queues,
      log: makeLog(),
      pipeline,
    });
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0]?.reason).toMatch(/boom/);
  });
});
