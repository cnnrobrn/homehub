/**
 * Unit tests for the node-regen handler (M3-B).
 *
 * We cover:
 *   - Happy path: the worker calls the model, writes `document_md`,
 *     preserves `manual_notes_md`, writes an audit row.
 *   - Empty-facts / empty-episodes → writes a stub document without
 *     calling the model.
 *   - Missing node → DLQ via pollOnce.
 */

import { type Database } from '@homehub/db';
import {
  type Logger,
  type MessageEnvelope,
  type ModelClient,
  type QueueClient,
  queueNames,
} from '@homehub/worker-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pollOnce, regenerateOne } from './handler.js';

type NodeRow = Database['mem']['Tables']['node']['Row'];
type FactRow = Database['mem']['Tables']['fact']['Row'];
type EpisodeRow = Database['mem']['Tables']['episode']['Row'];

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

interface State {
  node: NodeRow | null;
  factsBySubject: FactRow[];
  factsByObject: FactRow[];
  episodes: EpisodeRow[];
  nodeUpdates: Array<Record<string, unknown>>;
  auditInserts: Array<Record<string, unknown>>;
}

function makeSupabase(init: Partial<State> = {}) {
  const state: State = {
    node: init.node ?? null,
    factsBySubject: init.factsBySubject ?? [],
    factsByObject: init.factsByObject ?? [],
    episodes: init.episodes ?? [],
    nodeUpdates: [],
    auditInserts: [],
  };

  function memSchema(table: string) {
    if (table === 'node') {
      const filters: Record<string, unknown> = {};
      let mode: 'select' | 'update' = 'select';
      let patch: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        select() {
          mode = 'select';
          return chain;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          if (mode === 'update') {
            state.nodeUpdates.push(patch);
            return Promise.resolve({ data: null, error: null });
          }
          return chain;
        },
        async maybeSingle() {
          return { data: state.node, error: null };
        },
        update(p: Record<string, unknown>) {
          mode = 'update';
          patch = p;
          return chain;
        },
      };
      return chain;
    }
    if (table === 'fact') {
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        select() {
          return chain;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return chain;
        },
        is(col: string, val: unknown) {
          filters[col] = val;
          return chain;
        },
      };
      (chain as Record<string, unknown>).then = (fulfill: (v: unknown) => unknown) => {
        let rows: FactRow[];
        if (filters.subject_node_id) rows = state.factsBySubject;
        else if (filters.object_node_id) rows = state.factsByObject;
        else rows = [];
        return Promise.resolve(fulfill({ data: rows, error: null }));
      };
      return chain;
    }
    if (table === 'episode') {
      const chain: Record<string, unknown> = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        overlaps() {
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
      };
      (chain as Record<string, unknown>).then = (fulfill: (v: unknown) => unknown) => {
        return Promise.resolve(fulfill({ data: state.episodes, error: null }));
      };
      return chain;
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
      if (name === 'mem') return { from: (t: string) => memSchema(t) };
      if (name === 'audit') return { from: (t: string) => auditSchema(t) };
      throw new Error(`unexpected schema ${name}`);
    },
  };
  return { supabase, state };
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

  const sent: Array<{ queue: string; payload: MessageEnvelope }> = [];

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

const HOUSEHOLD_ID = 'a0000000-0000-4000-8000-000000000001';
const NODE_ID = 'n0000000-0000-4000-8000-000000000001';

const BASE_NODE: NodeRow = {
  id: NODE_ID,
  household_id: HOUSEHOLD_ID,
  type: 'person',
  canonical_name: 'Sarah',
  document_md: null,
  manual_notes_md: 'My personal Sarah notes',
  metadata: {},
  embedding: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  needs_review: false,
};

function env(): MessageEnvelope {
  return {
    household_id: HOUSEHOLD_ID,
    kind: 'node.regen',
    entity_id: NODE_ID,
    version: 1,
    enqueued_at: '2026-04-20T12:00:00.000Z',
  };
}

function makeModelClient(parsed: { document_md: string }): ModelClient {
  return {
    generate: vi.fn(async () => ({
      text: JSON.stringify(parsed),
      parsed,
      model: 'moonshotai/kimi-k2',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.001,
      latencyMs: 100,
    })),
    embed: vi.fn(),
  } as unknown as ModelClient;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('regenerateOne — happy path with facts + episodes', () => {
  it('calls the model and writes document_md, preserving manual_notes_md', async () => {
    const fact: FactRow = {
      id: 'f1',
      household_id: HOUSEHOLD_ID,
      subject_node_id: NODE_ID,
      predicate: 'is',
      object_value: 'vegetarian',
      object_node_id: null,
      confidence: 0.85,
      evidence: [],
      valid_from: '2026-01-01T00:00:00Z',
      valid_to: null,
      recorded_at: '2026-01-01T00:00:00Z',
      superseded_at: null,
      superseded_by: null,
      source: 'extraction',
      reinforcement_count: 2,
      last_reinforced_at: '2026-04-19T00:00:00Z',
      conflict_status: 'none',
    };
    const episode: EpisodeRow = {
      id: 'ep1',
      household_id: HOUSEHOLD_ID,
      title: 'Dinner',
      summary: 'Dinner at Giulia',
      occurred_at: '2026-04-12T20:00:00Z',
      ended_at: null,
      place_node_id: null,
      participants: [NODE_ID],
      source_type: 'event',
      source_id: '00000000-0000-0000-0000-000000000000',
      recorded_at: '2026-04-12T20:00:00Z',
      metadata: {},
      embedding: null,
    };
    const { supabase, state } = makeSupabase({
      node: BASE_NODE,
      factsBySubject: [fact],
      factsByObject: [],
      episodes: [episode],
    });
    const modelClient = makeModelClient({ document_md: '## Summary\n\nSarah is vegetarian.' });

    await regenerateOne(
      {
        supabase: supabase as never,
        queues: makeQueues().queues,
        log: makeLog(),
        modelClient,
        now: () => new Date('2026-04-20T12:34:00Z'),
      },
      env(),
    );

    // Model was called.
    expect(modelClient.generate).toHaveBeenCalledTimes(1);
    const callArgs = (modelClient.generate as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]![0] as {
      task: string;
      household_id: string;
      userPrompt: string;
    };
    expect(callArgs.task).toBe('summarization.node_doc');
    expect(callArgs.userPrompt).toContain('Sarah');
    expect(callArgs.userPrompt).toContain('vegetarian');

    // Node was updated with document_md only. manual_notes_md must
    // not appear in the update patch.
    expect(state.nodeUpdates).toHaveLength(1);
    const patch = state.nodeUpdates[0]!;
    expect(patch.document_md).toContain('Sarah is vegetarian');
    expect('manual_notes_md' in patch).toBe(false);

    // Audit row recorded.
    expect(state.auditInserts).toHaveLength(1);
    expect(state.auditInserts[0]!.action).toBe('mem.node.regenerated');
  });
});

describe('regenerateOne — empty facts and episodes', () => {
  it('writes a stub document and does NOT call the model', async () => {
    const { supabase, state } = makeSupabase({
      node: BASE_NODE,
      factsBySubject: [],
      factsByObject: [],
      episodes: [],
    });
    const modelClient = makeModelClient({ document_md: 'unused' });

    await regenerateOne(
      {
        supabase: supabase as never,
        queues: makeQueues().queues,
        log: makeLog(),
        modelClient,
        now: () => new Date('2026-04-20T12:34:00Z'),
      },
      env(),
    );

    expect(modelClient.generate).not.toHaveBeenCalled();
    expect(state.nodeUpdates).toHaveLength(1);
    const patch = state.nodeUpdates[0]!;
    expect(patch.document_md).toMatch(/Not yet learned/);
  });
});

describe('pollOnce — missing node → DLQ', () => {
  it('dead-letters when the node does not exist', async () => {
    const { supabase } = makeSupabase({ node: null });
    const { queues, deadLetters } = makeQueues({
      claim: {
        queue: queueNames.nodeRegen,
        msg: {
          messageId: 101,
          readCount: 1,
          enqueuedAt: 'x',
          vt: 'x',
          payload: env(),
        },
      },
    });
    const modelClient = makeModelClient({ document_md: 'unused' });

    const result = await pollOnce({
      supabase: supabase as never,
      queues,
      log: makeLog(),
      modelClient,
    });
    expect(result).toBe('claimed');
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0]?.reason).toMatch(/not found/);
  });
});
