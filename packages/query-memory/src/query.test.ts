/**
 * Unit tests for `createQueryMemory`.
 *
 * The fake Supabase is tailored to the exact queries `query_memory`
 * issues: select+eq on nodes / edges / patterns, select+eq+in on
 * facts, select+eq+overlaps / in on episodes. We seed each of the
 * stores per test and assert on the returned shape.
 */

import { type HouseholdId } from '@homehub/shared';
import { type Logger, type ModelClient } from '@homehub/worker-runtime';
import { describe, expect, it, vi } from 'vitest';

import { createQueryMemory } from './query.js';
import {
  type EdgeRow,
  type EpisodeRow,
  type FactRow,
  type NodeRow,
  type PatternRow,
} from './types.js';

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

interface Seed {
  nodes?: NodeRow[];
  edges?: EdgeRow[];
  facts?: FactRow[];
  episodes?: EpisodeRow[];
  patterns?: PatternRow[];
}

function makeSupabase(seed: Seed) {
  const { nodes = [], edges = [], facts = [], episodes = [], patterns = [] } = seed;

  function makeChain(source: unknown[]) {
    const filters: Record<string, unknown> = {};
    const inFilters: Record<string, unknown[]> = {};
    let overlapsFilter: { col: string; vals: unknown[] } | null = null;

    const chain: Record<string, unknown> = {
      select(): unknown {
        return chain;
      },
      eq(col: string, val: unknown) {
        filters[col] = val;
        return chain;
      },
      in(col: string, vals: unknown[]) {
        inFilters[col] = vals;
        return chain;
      },
      overlaps(col: string, vals: unknown[]) {
        overlapsFilter = { col, vals };
        return chain;
      },
      is(col: string, val: unknown) {
        filters[col] = val;
        return chain;
      },
    };

    (chain as Record<string, unknown>).then = (
      fulfill: (v: { data: unknown[]; error: null }) => unknown,
    ) => {
      const rows = (source as Record<string, unknown>[]).filter((row) => {
        for (const [k, v] of Object.entries(filters)) {
          if (row[k] !== v) return false;
        }
        for (const [k, vs] of Object.entries(inFilters)) {
          if (!vs.includes(row[k])) return false;
        }
        if (overlapsFilter) {
          const arr = row[overlapsFilter.col];
          if (!Array.isArray(arr)) return false;
          if (!overlapsFilter.vals.some((v) => arr.includes(v))) return false;
        }
        return true;
      });
      return Promise.resolve(fulfill({ data: rows, error: null }));
    };

    return chain;
  }

  const supabase = {
    schema(name: string) {
      if (name !== 'mem') throw new Error(`unexpected schema ${name}`);
      return {
        from(table: string) {
          if (table === 'node') return makeChain(nodes);
          if (table === 'edge') return makeChain(edges);
          if (table === 'fact') return makeChain(facts);
          if (table === 'episode') return makeChain(episodes);
          if (table === 'pattern') return makeChain(patterns);
          throw new Error(`unexpected mem.${table}`);
        },
      };
    },
  };
  return supabase;
}

function makeModelClient(embedding: number[] | Error): ModelClient {
  return {
    generate: vi.fn(),
    embed: vi.fn(async () => {
      if (embedding instanceof Error) throw embedding;
      return {
        embedding,
        model: 'x',
        inputTokens: 1,
        costUsd: 0,
        latencyMs: 1,
      };
    }),
  } as unknown as ModelClient;
}

const HOUSEHOLD_ID = 'a0000000-0000-4000-8000-000000000001' as unknown as HouseholdId;

function vec(v: number[]): string {
  return JSON.stringify(v);
}

function makeNode(patch: Partial<NodeRow>): NodeRow {
  return {
    id: 'n1',
    household_id: HOUSEHOLD_ID,
    type: 'person',
    canonical_name: 'node',
    document_md: null,
    manual_notes_md: null,
    metadata: {},
    embedding: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    needs_review: false,
    ...patch,
  };
}

function makeEdge(patch: Partial<EdgeRow>): EdgeRow {
  return {
    id: 'e1',
    household_id: HOUSEHOLD_ID,
    src_id: 'n1',
    dst_id: 'n2',
    type: 'related_to',
    weight: 1.0,
    evidence: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...patch,
  };
}

function makeFact(patch: Partial<FactRow>): FactRow {
  return {
    id: 'f1',
    household_id: HOUSEHOLD_ID,
    subject_node_id: 'n1',
    predicate: 'is',
    object_value: 'vegetarian',
    object_node_id: null,
    confidence: 0.8,
    evidence: [],
    valid_from: '2026-01-01T00:00:00Z',
    valid_to: null,
    recorded_at: '2026-01-01T00:00:00Z',
    superseded_at: null,
    superseded_by: null,
    source: 'extraction',
    reinforcement_count: 1,
    last_reinforced_at: '2026-01-01T00:00:00Z',
    conflict_status: 'none',
    ...patch,
  };
}

describe('createQueryMemory.query', () => {
  it('returns seeded nodes closest to the query embedding', async () => {
    const supabase = makeSupabase({
      nodes: [
        makeNode({ id: 'n1', canonical_name: 'Sarah', embedding: vec([1, 0, 0]) }),
        makeNode({ id: 'n2', canonical_name: 'Mateo', embedding: vec([0, 1, 0]) }),
        makeNode({ id: 'n3', canonical_name: 'Lila', embedding: vec([0, 0, 1]) }),
      ],
      edges: [],
      facts: [],
      episodes: [],
      patterns: [],
    });
    const model = makeModelClient([1, 0, 0]);
    const client = createQueryMemory({
      supabase: supabase as never,
      modelClient: model,
      log: makeLog(),
    });
    const result = await client.query({
      householdId: HOUSEHOLD_ID,
      query: 'tell me about sarah',
      limit: 1,
    });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.id).toBe('n1');
  });

  it('returns a seed node and its neighborhood via edges', async () => {
    // Only one node has an embedding — the others surface only through
    // structural expansion over mem.edge.
    const supabase = makeSupabase({
      nodes: [
        makeNode({ id: 'n1', embedding: vec([1, 0]) }),
        makeNode({ id: 'n2' }),
        makeNode({ id: 'n3' }),
        makeNode({ id: 'n4' }),
      ],
      edges: [
        makeEdge({ id: 'e1', src_id: 'n1', dst_id: 'n2' }),
        makeEdge({ id: 'e2', src_id: 'n2', dst_id: 'n3' }),
      ],
    });
    const model = makeModelClient([1, 0]);
    const client = createQueryMemory({
      supabase: supabase as never,
      modelClient: model,
      log: makeLog(),
    });
    const result = await client.query({
      householdId: HOUSEHOLD_ID,
      query: 'query',
      max_depth: 2,
      limit: 10,
    });
    // n1 (seed) + n2 (depth 1) + n3 (depth 2) make it in; n4 is
    // disconnected and absent.
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain('n1');
    expect(ids).toContain('n2');
    expect(ids).toContain('n3');
    expect(ids).not.toContain('n4');
  });

  it('filters live facts by default (valid_to null, not superseded)', async () => {
    const supabase = makeSupabase({
      nodes: [makeNode({ id: 'n1', embedding: vec([1, 0]) })],
      facts: [
        makeFact({ id: 'live', valid_to: null, superseded_at: null }),
        makeFact({
          id: 'expired',
          valid_to: '2026-01-15T00:00:00Z',
          superseded_at: '2026-01-15T00:00:00Z',
        }),
      ],
    });
    const model = makeModelClient([1, 0]);
    const client = createQueryMemory({
      supabase: supabase as never,
      modelClient: model,
      log: makeLog(),
      now: () => new Date('2026-04-20T00:00:00Z'),
    });
    const result = await client.query({ householdId: HOUSEHOLD_ID, query: 'q' });
    expect(result.facts.map((f) => f.id)).toEqual(['live']);
  });

  it('honors as_of — returns only facts valid at that time', async () => {
    const supabase = makeSupabase({
      nodes: [makeNode({ id: 'n1', embedding: vec([1, 0]) })],
      facts: [
        // Valid 2025-11-01 → 2026-02-01 (ended before the as_of).
        makeFact({
          id: 'old',
          valid_from: '2025-11-01T00:00:00Z',
          valid_to: '2026-02-01T00:00:00Z',
          recorded_at: '2025-11-01T00:00:00Z',
          superseded_at: '2026-02-01T00:00:00Z',
        }),
        // Valid 2026-02-01 → present — was true as_of 2026-03-01.
        makeFact({
          id: 'current',
          valid_from: '2026-02-01T00:00:00Z',
          valid_to: null,
          recorded_at: '2026-02-01T00:00:00Z',
        }),
      ],
    });
    const model = makeModelClient([1, 0]);
    const client = createQueryMemory({
      supabase: supabase as never,
      modelClient: model,
      log: makeLog(),
    });
    const result = await client.query({
      householdId: HOUSEHOLD_ID,
      query: 'q',
      as_of: '2026-03-01T00:00:00Z',
    });
    const ids = result.facts.map((f) => f.id);
    expect(ids).toContain('current');
    // Pre-as_of expired fact is also kept if it was valid at the as_of
    // moment — but in our seed the expired fact's valid_to is 2026-02-01
    // (strictly before the as_of), so it's excluded.
    expect(ids).not.toContain('old');
  });

  it('surfaces conflicts separately', async () => {
    const supabase = makeSupabase({
      nodes: [makeNode({ id: 'n1', embedding: vec([1, 0]) })],
      facts: [
        makeFact({ id: 'ok' }),
        makeFact({ id: 'parked', conflict_status: 'parked_conflict' }),
      ],
    });
    const model = makeModelClient([1, 0]);
    const client = createQueryMemory({
      supabase: supabase as never,
      modelClient: model,
      log: makeLog(),
    });
    const result = await client.query({ householdId: HOUSEHOLD_ID, query: 'q' });
    expect(result.conflicts.map((f) => f.id)).toContain('parked');
  });

  it('drops procedural patterns when that layer is excluded', async () => {
    const supabase = makeSupabase({
      nodes: [makeNode({ id: 'n1', embedding: vec([1, 0]) })],
      patterns: [
        {
          id: 'p1',
          household_id: HOUSEHOLD_ID,
          kind: 'temporal',
          description: 'Groceries on Saturday mornings',
          parameters: { period_days: 7 },
          confidence: 0.8,
          sample_size: 12,
          observed_from: '2026-01-01T00:00:00Z',
          observed_to: '2026-04-15T00:00:00Z',
          last_reinforced_at: '2026-04-18T00:00:00Z',
          status: 'active',
        },
      ],
    });
    const model = makeModelClient([1, 0]);
    const client = createQueryMemory({
      supabase: supabase as never,
      modelClient: model,
      log: makeLog(),
      now: () => new Date('2026-04-20T00:00:00Z'),
    });
    const withPatterns = await client.query({ householdId: HOUSEHOLD_ID, query: 'q' });
    expect(withPatterns.patterns).toHaveLength(1);
    const episodicOnly = await client.query({
      householdId: HOUSEHOLD_ID,
      query: 'q',
      layers: ['episodic'],
    });
    expect(episodicOnly.patterns).toHaveLength(0);
  });

  it('M3.7-A: excludes decayed patterns from default retrieval', async () => {
    const supabase = makeSupabase({
      nodes: [makeNode({ id: 'n1', embedding: vec([1, 0]) })],
      patterns: [
        // Fresh pattern: 2 days since last reinforcement < 21d threshold.
        {
          id: 'fresh',
          household_id: HOUSEHOLD_ID,
          kind: 'temporal',
          description: 'Fresh',
          parameters: { period_days: 7 },
          confidence: 0.8,
          sample_size: 10,
          observed_from: '2026-01-01T00:00:00Z',
          observed_to: '2026-04-15T00:00:00Z',
          last_reinforced_at: '2026-04-18T00:00:00Z',
          status: 'active',
        },
        // Decayed pattern: 50 days since last reinforcement > 21d threshold.
        {
          id: 'decayed',
          household_id: HOUSEHOLD_ID,
          kind: 'temporal',
          description: 'Decayed',
          parameters: { period_days: 7 },
          confidence: 0.8,
          sample_size: 10,
          observed_from: '2026-01-01T00:00:00Z',
          observed_to: '2026-03-01T00:00:00Z',
          last_reinforced_at: '2026-03-01T00:00:00Z',
          status: 'active',
        },
      ],
    });
    const model = makeModelClient([1, 0]);
    const client = createQueryMemory({
      supabase: supabase as never,
      modelClient: model,
      log: makeLog(),
      now: () => new Date('2026-04-20T00:00:00Z'),
    });
    const result = await client.query({ householdId: HOUSEHOLD_ID, query: 'q' });
    const ids = result.patterns.map((p) => p.id);
    expect(ids).toContain('fresh');
    expect(ids).not.toContain('decayed');

    // as_of bypasses the decay filter — the row is still on disk.
    const asOfResult = await client.query({
      householdId: HOUSEHOLD_ID,
      query: 'q',
      as_of: '2026-04-20T00:00:00Z',
    });
    const asOfIds = asOfResult.patterns.map((p) => p.id);
    expect(asOfIds).toContain('fresh');
    expect(asOfIds).toContain('decayed');
  });

  it('M3.7-A: filters stale consolidation candidate facts older than 90 days', async () => {
    const supabase = makeSupabase({
      nodes: [makeNode({ id: 'n1', embedding: vec([1, 0]) })],
      facts: [
        // Fresh canonical fact.
        makeFact({ id: 'fresh' }),
        // Stale, low-reinforcement consolidation-sourced fact.
        makeFact({
          id: 'stale-candidate',
          source: 'consolidation',
          reinforcement_count: 1,
          last_reinforced_at: '2026-01-01T00:00:00Z',
        }),
        // Stale but well-reinforced consolidation fact — kept.
        makeFact({
          id: 'stale-reinforced',
          source: 'consolidation',
          reinforcement_count: 5,
          last_reinforced_at: '2026-01-01T00:00:00Z',
        }),
      ],
    });
    const model = makeModelClient([1, 0]);
    const client = createQueryMemory({
      supabase: supabase as never,
      modelClient: model,
      log: makeLog(),
      now: () => new Date('2026-04-20T00:00:00Z'),
    });
    const result = await client.query({ householdId: HOUSEHOLD_ID, query: 'q' });
    const ids = result.facts.map((f) => f.id);
    expect(ids).toContain('fresh');
    expect(ids).not.toContain('stale-candidate');
    expect(ids).toContain('stale-reinforced');
  });

  it('falls back gracefully when embed() fails', async () => {
    const supabase = makeSupabase({
      nodes: [makeNode({ id: 'n1' }), makeNode({ id: 'n2' })],
      edges: [],
    });
    const model = makeModelClient(new Error('embed down'));
    const client = createQueryMemory({
      supabase: supabase as never,
      modelClient: model,
      log: makeLog(),
    });
    const result = await client.query({ householdId: HOUSEHOLD_ID, query: 'q' });
    // Both nodes returned (neutral similarity; ordering not
    // meaningful), no throw.
    expect(result.nodes.length).toBe(2);
  });

  it('uses provided weights and respects halfLife override', async () => {
    const supabase = makeSupabase({
      nodes: [makeNode({ id: 'n1', updated_at: '2026-04-19T00:00:00Z', embedding: vec([1, 0]) })],
    });
    const model = makeModelClient([1, 0]);
    const client = createQueryMemory({
      supabase: supabase as never,
      modelClient: model,
      log: makeLog(),
      now: () => new Date('2026-04-20T00:00:00Z'),
    });
    const result = await client.query({
      householdId: HOUSEHOLD_ID,
      query: 'q',
      recency_half_life_days: 1,
      weights: {
        semantic: 0,
        recency: 1,
        connectivity: 0,
        typePrior: 0,
        confidence: 0,
        conflict: 0,
      },
    });
    expect(result.nodes).toHaveLength(1);
  });
});
