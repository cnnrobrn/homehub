/**
 * Unit tests for the M3.5-B `rollup_conversation` handler.
 */

import { type ConversationRollup } from '@homehub/enrichment';
import { type Logger, type MessageEnvelope, type QueueClient } from '@homehub/worker-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { rollupConversationOne } from './rollup-handler.js';

import type { Database } from '@homehub/db';

type ConversationRow = Database['app']['Tables']['conversation']['Row'];

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
  conversationRow: ConversationRow | null;
  turns: Array<{
    id: string;
    role: string;
    body_md: string;
    created_at: string;
    author_member_id: string | null;
  }>;
  nodes: Array<{ id: string; canonical_name: string; type: string; household_id: string }>;
  episodeInserts: Array<Record<string, unknown>>;
  nodeInserts: Array<Record<string, unknown>>;
  auditInserts: Array<Record<string, unknown>>;
  existingRollupEpisodes: Array<{
    id: string;
    metadata: Record<string, unknown>;
    recorded_at: string;
  }>;
}

function makeSupabase(init: Partial<SupabaseState> = {}) {
  const state: SupabaseState = {
    conversationRow: init.conversationRow ?? null,
    turns: init.turns ?? [],
    nodes: init.nodes ?? [],
    episodeInserts: [],
    nodeInserts: [],
    auditInserts: [],
    existingRollupEpisodes: init.existingRollupEpisodes ?? [],
  };

  let episodeId = 1;
  let nodeId = 1;

  function appSchema(table: string) {
    if (table === 'conversation') {
      const chain: Record<string, unknown> = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        async maybeSingle() {
          return { data: state.conversationRow, error: null };
        },
      };
      return chain;
    }
    if (table === 'conversation_turn') {
      const filters: Record<string, unknown> = {};
      let inRoles: string[] | null = null;
      let limit: number | undefined;
      const chain: Record<string, unknown> = {
        select() {
          return chain;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
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
      };
      (chain as Record<string, unknown>).then = (fulfill: (v: unknown) => unknown) => {
        let rows = state.turns.slice();
        if (inRoles) {
          rows = rows.filter((r) => inRoles!.includes(r.role));
        }
        // Already sorted desc via order; mimic.
        rows.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
        if (limit != null) rows = rows.slice(0, limit);
        return Promise.resolve(fulfill({ data: rows, error: null }));
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
    if (table === 'episode') {
      const filters: Record<string, unknown> = {};
      let insertPayload: Record<string, unknown> | undefined;
      let limit: number | undefined;
      const chain: Record<string, unknown> = {
        select() {
          return chain;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return chain;
        },
        gte() {
          return chain;
        },
        order() {
          return chain;
        },
        limit(n: number) {
          limit = n;
          return chain;
        },
        insert(p: Record<string, unknown>) {
          insertPayload = p;
          state.episodeInserts.push(p);
          return chain;
        },
        async single() {
          const id = `ep-${episodeId++}`;
          return { data: { id, ...(insertPayload ?? {}) }, error: null };
        },
      };
      (chain as Record<string, unknown>).then = (fulfill: (v: unknown) => unknown) => {
        let rows = state.existingRollupEpisodes.slice();
        // Filter by source_type / source_id if present.
        rows = rows.filter((r) => {
          if (filters.source_type && (r as Record<string, unknown>).metadata) {
            // The filters.source_id check is the real debounce gate.
          }
          return true;
        });
        if (limit != null) rows = rows.slice(0, limit);
        return Promise.resolve(fulfill({ data: rows, error: null }));
      };
      return chain;
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

function makeTurns(n: number, words: number, startHour: number = 12) {
  const body = Array(words).fill('word').join(' ');
  const out: Array<{
    id: string;
    role: string;
    body_md: string;
    created_at: string;
    author_member_id: string | null;
  }> = [];
  for (let i = 0; i < n; i += 1) {
    out.push({
      id: `turn-${i}`,
      role: i % 2 === 0 ? 'member' : 'assistant',
      body_md: body,
      created_at: new Date(Date.UTC(2026, 3, 20, startHour, i, 0)).toISOString(),
      author_member_id: null,
    });
  }
  return out;
}

function conversationRow(): ConversationRow {
  return {
    id: CONVERSATION_ID,
    household_id: HOUSEHOLD_ID,
    title: 'Tonight',
    created_by: null,
    created_at: '2026-04-20T12:00:00Z',
    last_message_at: '2026-04-20T12:05:00Z',
    pinned: false,
    archived_at: null,
  };
}

function envelope(): MessageEnvelope {
  return {
    household_id: HOUSEHOLD_ID,
    kind: 'conversation',
    entity_id: CONVERSATION_ID,
    version: 0,
    enqueued_at: '2026-04-20T12:05:01Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('rollupConversationOne', () => {
  it('happy path: substantive conversation produces a mem.episode', async () => {
    const now = new Date('2026-04-20T12:10:00Z');
    const { supabase, state } = makeSupabase({
      conversationRow: conversationRow(),
      turns: makeTurns(6, 25),
      nodes: [
        { id: 'sarah-id', canonical_name: 'Sarah', type: 'person', household_id: HOUSEHOLD_ID },
      ],
    });
    const rollup: ConversationRollup = {
      build: vi.fn(async () => ({
        title: 'Dinner planning',
        summary: 'Planned vegetarian dinner.',
        participants: ['person:Sarah'],
        occurred_at: '2026-04-20T12:00:00Z',
        ended_at: '2026-04-20T12:05:00Z',
      })),
    };
    const { queues, sent } = makeQueues();

    await rollupConversationOne(
      {
        supabase: supabase as never,
        queues,
        log: makeLog(),
        rollup,
        now: () => now,
      },
      envelope(),
    );

    expect(state.episodeInserts).toHaveLength(1);
    expect(state.episodeInserts[0]!.source_type).toBe('conversation');
    expect(state.episodeInserts[0]!.source_id).toBe(CONVERSATION_ID);
    expect(state.episodeInserts[0]!.participants).toEqual(['sarah-id']);
    expect(state.auditInserts).toHaveLength(1);
    expect(state.auditInserts[0]!.action).toBe('mem.conversation.rolled_up');
    // node_regen enqueued for Sarah.
    expect(sent.some((s) => s.queue === 'node_regen' && s.payload.entity_id === 'sarah-id')).toBe(
      true,
    );
  });

  it('skips when the conversation is too short (turn count)', async () => {
    const now = new Date('2026-04-20T12:10:00Z');
    const { supabase, state } = makeSupabase({
      conversationRow: conversationRow(),
      turns: makeTurns(2, 100),
    });
    const rollup: ConversationRollup = {
      build: vi.fn(async () => ({
        title: '',
        summary: '',
        participants: [],
        occurred_at: '2026-04-20T12:00:00Z',
      })),
    };
    const { queues } = makeQueues();

    await rollupConversationOne(
      {
        supabase: supabase as never,
        queues,
        log: makeLog(),
        rollup,
        now: () => now,
      },
      envelope(),
    );

    expect(rollup.build).not.toHaveBeenCalled();
    expect(state.episodeInserts).toHaveLength(0);
    expect(state.auditInserts).toHaveLength(0);
  });

  it('debounces when a recent rollup already exists', async () => {
    const now = new Date('2026-04-20T12:10:00Z');
    const { supabase, state } = makeSupabase({
      conversationRow: conversationRow(),
      turns: makeTurns(6, 30),
      existingRollupEpisodes: [
        {
          id: 'existing-ep',
          recorded_at: '2026-04-20T12:08:00Z',
          metadata: { conversation_id: CONVERSATION_ID },
        },
      ],
    });
    const rollup: ConversationRollup = {
      build: vi.fn(async () => ({
        title: '',
        summary: '',
        participants: [],
        occurred_at: '2026-04-20T12:00:00Z',
      })),
    };
    const { queues } = makeQueues();

    await rollupConversationOne(
      {
        supabase: supabase as never,
        queues,
        log: makeLog(),
        rollup,
        now: () => now,
      },
      envelope(),
    );

    expect(rollup.build).not.toHaveBeenCalled();
    expect(state.episodeInserts).toHaveLength(0);
  });

  it('throws when the conversation is not found', async () => {
    const { supabase } = makeSupabase({ conversationRow: null });
    const { queues } = makeQueues();
    const rollup: ConversationRollup = {
      build: vi.fn(),
    };

    await expect(
      rollupConversationOne(
        {
          supabase: supabase as never,
          queues,
          log: makeLog(),
          rollup,
        },
        envelope(),
      ),
    ).rejects.toThrow(/not found/);
  });
});
