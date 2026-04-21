/**
 * Tests for the `get_node` tool adapter.
 *
 * We fake a per-table chain that honors eq/is/contains/limit/order
 * and returns whatever rows match the collected filters. We assert:
 *   - Node exists and belongs to the caller's household → returns full
 *     bundle.
 *   - Node belongs to another household → returns `{ node: null, ... }`
 *     without leaking its presence.
 *   - Node doesn't exist → same `{ node: null, ... }` envelope.
 *   - `include_*` flags toggle the related queries.
 *   - Bad UUID input is rejected.
 */

import { type ServiceSupabaseClient } from '@homehub/worker-runtime';
import { describe, expect, it } from 'vitest';

import { type AuthContext } from '../middleware/auth.js';

import { createGetNodeTool } from './getNode.js';

const HOUSEHOLD = 'a0000000-0000-4000-8000-000000000001';
const OTHER_HOUSEHOLD = 'b0000000-0000-4000-8000-000000000002';
const MEMBER = 'c0000000-0000-4000-8000-000000000010';
const NODE_A = 'd0000000-0000-4000-8000-000000000a01';
const NODE_B = 'd0000000-0000-4000-8000-000000000a02';

function memberCtx(): AuthContext {
  return {
    kind: 'member',
    householdId: HOUSEHOLD as AuthContext['householdId'],
    memberId: MEMBER as Extract<AuthContext, { kind: 'member' }>['memberId'],
    scopes: ['*'],
    tokenId: 'dev:test',
  };
}

interface Seeds {
  nodes?: Array<Record<string, unknown>>;
  facts?: Array<Record<string, unknown>>;
  episodes?: Array<Record<string, unknown>>;
  edges?: Array<Record<string, unknown>>;
}

function matches(row: Record<string, unknown>, filters: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(filters)) {
    if (k.startsWith('__contains__')) {
      const col = k.slice('__contains__'.length);
      const arr = row[col];
      const vals = v as unknown[];
      if (!Array.isArray(arr)) return false;
      if (!vals.every((val) => arr.includes(val))) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

function makeChain(source: Array<Record<string, unknown>>, maybeSingleMode = false): unknown {
  const filters: Record<string, unknown> = {};
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq(col: string, val: unknown) {
      filters[col] = val;
      return chain;
    },
    is(col: string, val: unknown) {
      filters[col] = val;
      return chain;
    },
    contains(col: string, vals: unknown[]) {
      filters[`__contains__${col}`] = vals;
      return chain;
    },
    order(_col: string, _opts: unknown) {
      return chain;
    },
    limit(_n: number) {
      return chain;
    },
    maybeSingle() {
      const matched = source.filter((r) => matches(r, filters));
      return Promise.resolve({ data: matched[0] ?? null, error: null });
    },
  };

  if (maybeSingleMode) {
    return chain;
  }

  (chain as Record<string, unknown>).then = (
    resolve: (v: { data: unknown[]; error: null }) => void,
  ) => {
    resolve({ data: source.filter((r) => matches(r, filters)), error: null });
  };
  return chain;
}

function makeFakeSupabase(seeds: Seeds): ServiceSupabaseClient {
  const { nodes = [], facts = [], episodes = [], edges = [] } = seeds;
  return {
    schema(name: string) {
      if (name !== 'mem') throw new Error(`unexpected schema ${name}`);
      return {
        from(table: string) {
          if (table === 'node') return makeChain(nodes, true);
          if (table === 'fact') return makeChain(facts);
          if (table === 'episode') return makeChain(episodes);
          if (table === 'edge') return makeChain(edges);
          throw new Error(`unexpected mem.${table}`);
        },
      };
    },
  } as unknown as ServiceSupabaseClient;
}

describe('createGetNodeTool', () => {
  it('returns the node and its facts / episodes / edges when the node exists', async () => {
    const supabase = makeFakeSupabase({
      nodes: [{ id: NODE_A, household_id: HOUSEHOLD, type: 'person', canonical_name: 'Sarah' }],
      facts: [
        {
          id: 'f1',
          household_id: HOUSEHOLD,
          subject_node_id: NODE_A,
          predicate: 'is',
          valid_to: null,
          superseded_at: null,
        },
      ],
      episodes: [
        {
          id: 'ep1',
          household_id: HOUSEHOLD,
          occurred_at: '2026-04-10T00:00:00Z',
          source_type: 'event',
          title: 'Dinner',
          participants: [NODE_A],
          place_node_id: null,
        },
      ],
      edges: [
        {
          id: 'e1',
          household_id: HOUSEHOLD,
          src_id: NODE_A,
          dst_id: NODE_B,
          type: 'related_to',
        },
      ],
    });
    const tool = createGetNodeTool({ supabase });
    const res = await tool.handler({ node_id: NODE_A }, memberCtx());
    const parsed = JSON.parse(res.content[0]?.text ?? '{}') as {
      node: Record<string, unknown> | null;
      facts: unknown[];
      episodes: unknown[];
      edges: unknown[];
    };
    expect(parsed.node).toMatchObject({ id: NODE_A });
    expect(parsed.facts).toHaveLength(1);
    expect(parsed.episodes).toHaveLength(1);
    expect(parsed.edges).toHaveLength(1);
  });

  it('returns node: null when the node belongs to a different household', async () => {
    const supabase = makeFakeSupabase({
      nodes: [{ id: NODE_A, household_id: OTHER_HOUSEHOLD, type: 'person' }],
    });
    const tool = createGetNodeTool({ supabase });
    const res = await tool.handler({ node_id: NODE_A }, memberCtx());
    expect(JSON.parse(res.content[0]?.text ?? '{}')).toEqual({
      node: null,
      facts: [],
      episodes: [],
      edges: [],
    });
  });

  it('returns node: null when the node does not exist', async () => {
    const supabase = makeFakeSupabase({});
    const tool = createGetNodeTool({ supabase });
    const res = await tool.handler({ node_id: NODE_A }, memberCtx());
    expect(JSON.parse(res.content[0]?.text ?? '{}')).toEqual({
      node: null,
      facts: [],
      episodes: [],
      edges: [],
    });
  });

  it('honors include_facts=false / include_episodes=false / include_edges=false', async () => {
    const supabase = makeFakeSupabase({
      nodes: [{ id: NODE_A, household_id: HOUSEHOLD, type: 'person' }],
      facts: [
        {
          id: 'f1',
          household_id: HOUSEHOLD,
          subject_node_id: NODE_A,
          valid_to: null,
          superseded_at: null,
        },
      ],
      episodes: [
        {
          id: 'ep1',
          household_id: HOUSEHOLD,
          participants: [NODE_A],
          occurred_at: '2026-04-10T00:00:00Z',
        },
      ],
      edges: [{ id: 'e1', household_id: HOUSEHOLD, src_id: NODE_A, dst_id: NODE_B }],
    });
    const tool = createGetNodeTool({ supabase });
    const res = await tool.handler(
      { node_id: NODE_A, include_facts: false, include_episodes: false, include_edges: false },
      memberCtx(),
    );
    const parsed = JSON.parse(res.content[0]?.text ?? '{}') as {
      node: unknown;
      facts: unknown[];
      episodes: unknown[];
      edges: unknown[];
    };
    expect(parsed.node).toBeTruthy();
    expect(parsed.facts).toEqual([]);
    expect(parsed.episodes).toEqual([]);
    expect(parsed.edges).toEqual([]);
  });

  it('rejects non-UUID node_id inputs', async () => {
    const supabase = makeFakeSupabase({});
    const tool = createGetNodeTool({ supabase });
    await expect(tool.handler({ node_id: 'not-a-uuid' }, memberCtx())).rejects.toThrow();
  });
});
