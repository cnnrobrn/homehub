/**
 * Unit tests for the M3.5-B `enrich_conversation` handler.
 */

import { type ConversationExtractor } from '@homehub/enrichment';
import { type Logger, type MessageEnvelope, type QueueClient } from '@homehub/worker-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { enrichConversationOne } from './conversation-handler.js';

import type { Database } from '@homehub/db';

type TurnRow = Database['app']['Tables']['conversation_turn']['Row'];

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

interface SupabaseState {
  turnRow: TurnRow | null;
  tailTurns: Array<{ id: string; role: string; body_md: string; created_at: string }>;
  nodes: Array<{ id: string; canonical_name: string; type: string; household_id: string }>;
  candidateInserts: Array<Record<string, unknown>>;
  ruleInserts: Array<Record<string, unknown>>;
  nodeInserts: Array<Record<string, unknown>>;
  auditInserts: Array<Record<string, unknown>>;
  factCandidates: Map<string, Record<string, unknown>>;
  facts: Map<string, Record<string, unknown>>;
}

function makeSupabase(init: Partial<SupabaseState> = {}) {
  const state: SupabaseState = {
    turnRow: init.turnRow ?? null,
    tailTurns: init.tailTurns ?? [],
    nodes: init.nodes ?? [],
    candidateInserts: [],
    ruleInserts: [],
    nodeInserts: [],
    auditInserts: [],
    factCandidates: new Map(),
    facts: new Map(),
  };

  let candidateId = 1;
  let nodeId = 1;

  function appSchema(table: string) {
    if (table === 'conversation_turn') {
      const filters: Record<string, unknown> = {};
      let inRoles: string[] | null = null;
      let neqId: string | undefined;
      let limit: number | undefined;
      const chain: Record<string, unknown> = {
        select() {
          return chain;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return chain;
        },
        neq(col: string, val: unknown) {
          if (col === 'id') neqId = val as string;
          return chain;
        },
        in(col: string, vals: string[]) {
          if (col === 'role') inRoles = vals;
          return chain;
        },
        order() {
          return chain;
        },
        limit(n: number) {
          limit = n;
          return chain;
        },
        async maybeSingle() {
          return { data: state.turnRow, error: null };
        },
      };

      (chain as Record<string, unknown>).then = (fulfill: (v: unknown) => unknown) => {
        let rows = state.tailTurns.slice();
        if (filters.conversation_id) {
          rows = rows.filter((_r) => true);
        }
        if (neqId) {
          rows = rows.filter((r) => r.id !== neqId);
        }
        if (inRoles) {
          rows = rows.filter((r) => inRoles!.includes(r.role));
        }
        if (limit != null) rows = rows.slice(0, limit);
        return Promise.resolve(fulfill({ data: rows, error: null }));
      };
      return chain;
    }
    if (table === 'member') {
      const chain: Record<string, unknown> = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        async maybeSingle() {
          return { data: { display_name: 'Owner' }, error: null };
        },
      };
      return chain;
    }
    throw new Error(`unexpected app.${table}`);
  }

  function memSchema(table: string) {
    if (table === 'node') {
      const filters: Record<string, unknown> = {};
      let ilikePattern: { col: string; val: string } | null = null;
      let insertPayload: Record<string, unknown> | undefined;
      let limit: number | undefined;
      const chain: Record<string, unknown> = {
        select(_cols?: string) {
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
      };
      (chain as Record<string, unknown>).then = (fulfill: (v: unknown) => unknown) => {
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
        return Promise.resolve(fulfill({ data: rows.map((r) => ({ id: r.id })), error: null }));
      };
      return chain;
    }
    if (table === 'alias') {
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
        limit() {
          return chain;
        },
        update() {
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
      };
      (chain as Record<string, unknown>).then = (fulfill: (v: unknown) => unknown) => {
        return Promise.resolve(fulfill({ data: [], error: null }));
      };
      return chain;
    }
    if (table === 'rule') {
      return {
        insert(p: Record<string, unknown>) {
          state.ruleInserts.push(p);
          return Promise.resolve({ data: null, error: null });
        },
      };
    }
    throw new Error(`unexpected mem.${table}`);
  }

  function auditSchema(_table: string) {
    return {
      insert(row: Record<string, unknown>) {
        state.auditInserts.push(row);
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  const supabase = {
    schema(name: string) {
      if (name === 'app') return { from: (t: string) => appSchema(t) };
      if (name === 'mem') return { from: (t: string) => memSchema(t) };
      if (name === 'audit') return { from: (t: string) => auditSchema(t) };
      throw new Error(`unexpected schema ${name}`);
    },
  };
  return { supabase, state };
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

// ---- Fixtures ---------------------------------------------------------

const HOUSEHOLD_ID = 'a0000000-0000-4000-8000-000000000001';
const CONVERSATION_ID = '20000000-0000-4000-8000-000000000001';
const TURN_ID = '30000000-0000-4000-8000-000000000001';
const MEMBER_ID = '40000000-0000-4000-8000-000000000001';

function memberTurn(overrides: Partial<TurnRow> = {}): TurnRow {
  return {
    id: TURN_ID,
    conversation_id: CONVERSATION_ID,
    household_id: HOUSEHOLD_ID,
    author_member_id: MEMBER_ID,
    role: 'member',
    body_md: 'Sarah is vegetarian now.',
    tool_calls: null,
    citations: null,
    created_at: '2026-04-20T12:00:00Z',
    model: null,
    input_tokens: null,
    output_tokens: null,
    cost_cents: null,
    no_memory_write: false,
    ...overrides,
  };
}

function envelope(): MessageEnvelope {
  return {
    household_id: HOUSEHOLD_ID,
    kind: 'member_turn',
    entity_id: TURN_ID,
    version: 0,
    enqueued_at: '2026-04-20T12:00:01Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('enrichConversationOne', () => {
  it('happy path: writes 2 facts + 1 rule, reconciles, enqueues node_regen', async () => {
    const now = new Date('2026-04-20T12:00:02Z');
    const { supabase, state } = makeSupabase({
      turnRow: memberTurn(),
      nodes: [
        { id: 'sarah-id', canonical_name: 'Sarah', type: 'person', household_id: HOUSEHOLD_ID },
      ],
    });
    const extractor: ConversationExtractor = {
      extract: vi.fn(async () => ({
        facts: [
          {
            id: 'f_001',
            subject: 'person:Sarah',
            predicate: 'is',
            object_value: 'vegetarian',
            confidence: 0.85,
            evidence: 'Sarah is vegetarian now.',
            valid_from: 'inferred',
          },
          {
            id: 'f_002',
            subject: 'person:Sarah',
            predicate: 'allergic_to',
            object_value: 'peanuts',
            confidence: 0.8,
            evidence: 'also peanut-allergic',
            valid_from: 'inferred',
          },
        ],
        rules: [
          {
            id: 'r_001',
            description: 'No restaurants on Tuesdays.',
            predicate_dsl: { kind: 'temporal_exclusion' },
          },
        ],
      })),
    };
    const { queues, sent } = makeQueues();

    await enrichConversationOne(
      {
        supabase: supabase as never,
        queues,
        log: makeLog(),
        extractor,
        now: () => now,
      },
      envelope(),
    );

    expect(state.candidateInserts).toHaveLength(2);
    expect(state.candidateInserts[0]!.source).toBe('member');
    expect(state.ruleInserts).toHaveLength(1);
    expect((state.ruleInserts[0] as { author_member_id: string }).author_member_id).toBe(MEMBER_ID);
    // One audit row written.
    expect(state.auditInserts).toHaveLength(1);
    expect(state.auditInserts[0]!.action).toBe('mem.conversation.extracted');
    // node_regen enqueued for Sarah.
    expect(sent.some((s) => s.queue === 'node_regen')).toBe(true);
  });

  it('whisper mode: no mem.* writes, no audit, no extraction call', async () => {
    const now = new Date('2026-04-20T12:00:02Z');
    const { supabase, state } = makeSupabase({
      turnRow: memberTurn({ no_memory_write: true }),
    });
    const extractor: ConversationExtractor = {
      extract: vi.fn(async () => ({ facts: [], rules: [] })),
    };
    const { queues } = makeQueues();

    await enrichConversationOne(
      {
        supabase: supabase as never,
        queues,
        log: makeLog(),
        extractor,
        now: () => now,
      },
      envelope(),
    );

    expect(extractor.extract).not.toHaveBeenCalled();
    expect(state.candidateInserts).toHaveLength(0);
    expect(state.ruleInserts).toHaveLength(0);
    expect(state.auditInserts).toHaveLength(0);
  });

  it('empty extraction (question): writes audit, no candidates/rules', async () => {
    const now = new Date('2026-04-20T12:00:02Z');
    const { supabase, state } = makeSupabase({
      turnRow: memberTurn({ body_md: "What's for dinner?" }),
    });
    const extractor: ConversationExtractor = {
      extract: vi.fn(async () => ({ facts: [], rules: [] })),
    };
    const { queues } = makeQueues();

    await enrichConversationOne(
      {
        supabase: supabase as never,
        queues,
        log: makeLog(),
        extractor,
        now: () => now,
      },
      envelope(),
    );

    expect(state.candidateInserts).toHaveLength(0);
    expect(state.ruleInserts).toHaveLength(0);
    expect(state.auditInserts).toHaveLength(1);
  });

  it('throws when the turn is not found (DLQ path)', async () => {
    const { supabase } = makeSupabase({ turnRow: null });
    const { queues } = makeQueues();
    const extractor: ConversationExtractor = {
      extract: vi.fn(async () => ({ facts: [], rules: [] })),
    };

    await expect(
      enrichConversationOne(
        {
          supabase: supabase as never,
          queues,
          log: makeLog(),
          extractor,
        },
        envelope(),
      ),
    ).rejects.toThrow(/not found/);
  });

  it('throws when the turn role is not member (DLQ path)', async () => {
    const { supabase } = makeSupabase({ turnRow: memberTurn({ role: 'assistant' }) });
    const { queues } = makeQueues();
    const extractor: ConversationExtractor = {
      extract: vi.fn(async () => ({ facts: [], rules: [] })),
    };

    await expect(
      enrichConversationOne(
        {
          supabase: supabase as never,
          queues,
          log: makeLog(),
          extractor,
        },
        envelope(),
      ),
    ).rejects.toThrow(/role must be 'member'/);
  });

  it('throws when the extractor fails (DLQ path)', async () => {
    const { supabase } = makeSupabase({ turnRow: memberTurn() });
    const { queues } = makeQueues();
    const extractor: ConversationExtractor = {
      extract: vi.fn(async () => {
        throw new Error('model down');
      }),
    };

    await expect(
      enrichConversationOne(
        {
          supabase: supabase as never,
          queues,
          log: makeLog(),
          extractor,
        },
        envelope(),
      ),
    ).rejects.toThrow(/conversation extractor failed/);
  });
});
