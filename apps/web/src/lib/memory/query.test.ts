/**
 * Unit tests for the `/memory` server helpers.
 *
 * Scope: filter composition (household-scoping), aggregate shape
 * (alias/fact counts, pinned-first ordering), and soft-delete
 * hiding. The underlying `@homehub/query-memory` package has its
 * own suite; these tests cover the thin web-app wrappers.
 */

import { describe, expect, it, vi } from 'vitest';

import type * as QueryMemoryModule from '@homehub/query-memory';

vi.mock('@/lib/memory/runtime-env', () => ({
  memoryRuntimeEnv: () => ({
    NODE_ENV: 'test',
    LOG_LEVEL: 'info',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    OPENROUTER_API_KEY: undefined,
    OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
    OPENROUTER_HTTP_REFERER: 'https://homehub.app',
    OPENROUTER_APP_TITLE: 'HomeHub',
  }),
}));

const { fakeClient, resetFake } = vi.hoisted(() => {
  const state: {
    responses: Map<string, unknown[]>;
    lastFilters: Array<{ table: string; op: string; column?: string; value?: unknown }>;
  } = { responses: new Map(), lastFilters: [] };

  function makeFakeClient() {
    return {
      schema(_schema: string) {
        return {
          from(table: string) {
            const filters: Array<{ op: string; column?: string; value?: unknown }> = [];
            const key = table;

            const chain: Record<string, unknown> = {
              select() {
                return chain;
              },
              eq(column: string, value: unknown) {
                filters.push({ op: 'eq', column, value });
                state.lastFilters.push({ table: key, op: 'eq', column, value });
                return chain;
              },
              in(column: string, value: unknown) {
                filters.push({ op: 'in', column, value });
                state.lastFilters.push({ table: key, op: 'in', column, value });
                return chain;
              },
              is(column: string, value: unknown) {
                filters.push({ op: 'is', column, value });
                return chain;
              },
              ilike(column: string, value: unknown) {
                filters.push({ op: 'ilike', column, value });
                return chain;
              },
              overlaps(column: string, value: unknown) {
                filters.push({ op: 'overlaps', column, value });
                return chain;
              },
              or(expr: string) {
                filters.push({ op: 'or', value: expr });
                return chain;
              },
              order() {
                return chain;
              },
              limit() {
                return chain;
              },
              maybeSingle() {
                const rows = (state.responses.get(key) ?? []) as unknown[];
                const row = rows[0] ?? null;
                return Promise.resolve({ data: row, error: null });
              },
              then(resolve: (v: { data: unknown[]; error: null }) => void) {
                const rows = (state.responses.get(key) ?? []) as unknown[];
                resolve({ data: rows, error: null });
              },
            };
            return chain;
          },
        };
      },
    };
  }

  return {
    fakeClient: makeFakeClient,
    resetFake: () => {
      state.responses = new Map();
      state.lastFilters = [];
      return state;
    },
  };
});

vi.mock('@homehub/worker-runtime', () => ({
  createServiceClient: () => fakeClient(),
  createModelClient: () => ({ embed: vi.fn(), generate: vi.fn() }),
}));

vi.mock('@homehub/query-memory', async () => {
  const actual = await vi.importActual<typeof QueryMemoryModule>('@homehub/query-memory');
  return {
    ...actual,
    createQueryMemory: () => ({
      query: vi.fn(async () => ({
        nodes: [],
        edges: [],
        facts: [],
        episodes: [],
        patterns: [],
        conflicts: [],
      })),
    }),
  };
});

// Import after mocks land.
// eslint-disable-next-line import/order
import { getNode, listNodes, queryHouseholdMemory } from './query';

const HOUSEHOLD = '11111111-1111-4111-8111-111111111111';
const NODE_ID = '22222222-2222-4222-8222-222222222222';

describe('queryHouseholdMemory', () => {
  it('returns the shape from @homehub/query-memory', async () => {
    const result = await queryHouseholdMemory({
      householdId: HOUSEHOLD as never,
      query: 'test',
    });
    expect(result).toEqual({
      nodes: [],
      edges: [],
      facts: [],
      episodes: [],
      patterns: [],
      conflicts: [],
    });
  });
});

describe('getNode', () => {
  it('returns null when the node does not exist', async () => {
    resetFake();
    const res = await getNode({ householdId: HOUSEHOLD, nodeId: NODE_ID });
    expect(res).toBeNull();
  });

  it('aggregates subject + object facts and participant + place episodes', async () => {
    const state = resetFake();
    state.responses.set('node', [
      {
        id: NODE_ID,
        household_id: HOUSEHOLD,
        type: 'person',
        canonical_name: 'Sarah',
        document_md: null,
        manual_notes_md: null,
        metadata: {},
        embedding: null,
        created_at: '2026-04-01T00:00:00Z',
        updated_at: '2026-04-05T00:00:00Z',
        needs_review: false,
      },
    ]);
    // The factory serves the same rows for both subject + object
    // selects (tests only care about dedupe).
    state.responses.set('fact', [
      {
        id: 'f1',
        household_id: HOUSEHOLD,
        subject_node_id: NODE_ID,
        predicate: 'age',
        object_value: 31,
        object_node_id: null,
        confidence: 0.9,
        evidence: [],
        valid_from: '2026-04-01T00:00:00Z',
        valid_to: null,
        recorded_at: '2026-04-01T00:00:00Z',
        superseded_at: null,
        superseded_by: null,
        source: 'extraction',
        reinforcement_count: 1,
        last_reinforced_at: '2026-04-01T00:00:00Z',
        conflict_status: 'none',
      },
    ]);
    state.responses.set('episode', [
      {
        id: 'e1',
        household_id: HOUSEHOLD,
        title: 'Dinner',
        summary: null,
        occurred_at: '2026-04-05T19:00:00Z',
        ended_at: null,
        place_node_id: null,
        participants: [NODE_ID],
        source_type: 'meal',
        source_id: 'dummy',
        recorded_at: '2026-04-05T19:00:00Z',
        metadata: {},
        embedding: null,
      },
    ]);
    state.responses.set('edge', [
      {
        id: 'ed1',
        household_id: HOUSEHOLD,
        src_id: NODE_ID,
        dst_id: 'other',
        type: 'attended',
        weight: 1,
        evidence: [],
        created_at: '2026-04-01T00:00:00Z',
        updated_at: '2026-04-01T00:00:00Z',
      },
    ]);

    const res = await getNode({ householdId: HOUSEHOLD, nodeId: NODE_ID });
    expect(res).not.toBeNull();
    expect(res?.node.id).toBe(NODE_ID);
    expect(res?.facts).toHaveLength(1);
    expect(res?.episodes).toHaveLength(1);
    expect(res?.edges).toHaveLength(1);
  });
});

describe('listNodes', () => {
  it('returns empty array when no nodes match', async () => {
    resetFake();
    const res = await listNodes({ householdId: HOUSEHOLD });
    expect(res).toEqual([]);
  });

  it('sorts pinned nodes first, then by updated_at desc', async () => {
    const state = resetFake();
    state.responses.set('node', [
      {
        id: 'a',
        household_id: HOUSEHOLD,
        type: 'person',
        canonical_name: 'Alpha',
        document_md: null,
        manual_notes_md: null,
        metadata: {},
        embedding: null,
        created_at: '2026-04-01T00:00:00Z',
        updated_at: '2026-04-10T00:00:00Z',
        needs_review: false,
      },
      {
        id: 'b',
        household_id: HOUSEHOLD,
        type: 'person',
        canonical_name: 'Beta',
        document_md: null,
        manual_notes_md: null,
        metadata: { pinned_by_member_ids: ['m1'] },
        embedding: null,
        created_at: '2026-04-01T00:00:00Z',
        updated_at: '2026-04-05T00:00:00Z',
        needs_review: false,
      },
    ]);
    state.responses.set('alias', []);
    state.responses.set('fact', []);
    const res = await listNodes({ householdId: HOUSEHOLD });
    expect(res.map((n) => n.id)).toEqual(['b', 'a']);
    expect(res[0]?.pinned).toBe(true);
  });

  it('hides soft-deleted nodes (metadata.deleted_at set)', async () => {
    const state = resetFake();
    state.responses.set('node', [
      {
        id: 'alive',
        household_id: HOUSEHOLD,
        type: 'person',
        canonical_name: 'Alive',
        document_md: null,
        manual_notes_md: null,
        metadata: {},
        embedding: null,
        created_at: '2026-04-01T00:00:00Z',
        updated_at: '2026-04-10T00:00:00Z',
        needs_review: false,
      },
      {
        id: 'gone',
        household_id: HOUSEHOLD,
        type: 'person',
        canonical_name: 'Gone',
        document_md: null,
        manual_notes_md: null,
        metadata: { deleted_at: '2026-04-06T00:00:00Z' },
        embedding: null,
        created_at: '2026-04-01T00:00:00Z',
        updated_at: '2026-04-06T00:00:00Z',
        needs_review: false,
      },
    ]);
    state.responses.set('alias', []);
    state.responses.set('fact', []);
    const res = await listNodes({ householdId: HOUSEHOLD });
    expect(res.map((n) => n.id)).toEqual(['alive']);
  });
});
