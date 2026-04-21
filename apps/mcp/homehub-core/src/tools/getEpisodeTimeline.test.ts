/**
 * Tests for the `get_episode_timeline` tool adapter.
 *
 * Fake chain captures every filter and returns the seeded rows. We
 * assert household scoping, window filters, source-type + participant
 * filtering, bad-input rejection, and degenerate-window
 * short-circuit.
 */

import { type ServiceSupabaseClient } from '@homehub/worker-runtime';
import { describe, expect, it } from 'vitest';

import { type AuthContext } from '../middleware/auth.js';

import { createGetEpisodeTimelineTool } from './getEpisodeTimeline.js';

const HOUSEHOLD = 'a0000000-0000-4000-8000-000000000001';
const MEMBER = 'c0000000-0000-4000-8000-000000000010';
const NODE = 'd0000000-0000-4000-8000-000000000a01';
const FROM = '2026-04-01T00:00:00.000Z';
const TO = '2026-05-01T00:00:00.000Z';

function memberCtx(): AuthContext {
  return {
    kind: 'member',
    householdId: HOUSEHOLD as AuthContext['householdId'],
    memberId: MEMBER as Extract<AuthContext, { kind: 'member' }>['memberId'],
    scopes: ['*'],
    tokenId: 'dev:test',
  };
}

interface CapturedCall {
  schema: string;
  table: string;
  filters: Array<{ op: string; column?: string; value?: unknown }>;
  order?: { column: string; ascending: boolean };
  limit?: number;
}

function makeFakeSupabase(rows: Array<Record<string, unknown>> = []): {
  client: ServiceSupabaseClient;
  captured: CapturedCall;
} {
  const captured: CapturedCall = { schema: '', table: '', filters: [] };
  const q = {
    select: () => q,
    eq(column: string, value: unknown) {
      captured.filters.push({ op: 'eq', column, value });
      return q;
    },
    gte(column: string, value: unknown) {
      captured.filters.push({ op: 'gte', column, value });
      return q;
    },
    lt(column: string, value: unknown) {
      captured.filters.push({ op: 'lt', column, value });
      return q;
    },
    in(column: string, value: unknown) {
      captured.filters.push({ op: 'in', column, value });
      return q;
    },
    contains(column: string, value: unknown) {
      captured.filters.push({ op: 'contains', column, value });
      return q;
    },
    order(column: string, opts: { ascending: boolean }) {
      captured.order = { column, ascending: opts.ascending };
      return q;
    },
    limit(n: number) {
      captured.limit = n;
      return q;
    },
    then(resolve: (v: { data: unknown[]; error: null }) => void) {
      resolve({ data: rows, error: null });
    },
  };
  const client = {
    schema(name: string) {
      captured.schema = name;
      return {
        from(table: string) {
          captured.table = table;
          return q;
        },
      };
    },
  } as unknown as ServiceSupabaseClient;
  return { client, captured };
}

describe('createGetEpisodeTimelineTool', () => {
  it('scopes to the auth household and applies the date window', async () => {
    const { client, captured } = makeFakeSupabase([]);
    const tool = createGetEpisodeTimelineTool({ supabase: client });
    await tool.handler({ from: FROM, to: TO }, memberCtx());
    expect(captured.schema).toBe('mem');
    expect(captured.table).toBe('episode');
    expect(captured.filters).toContainEqual({ op: 'eq', column: 'household_id', value: HOUSEHOLD });
    expect(captured.filters).toContainEqual({ op: 'gte', column: 'occurred_at', value: FROM });
    expect(captured.filters).toContainEqual({ op: 'lt', column: 'occurred_at', value: TO });
    expect(captured.order).toEqual({ column: 'occurred_at', ascending: true });
    expect(captured.limit).toBe(100);
  });

  it('applies source_types and participant_node_id filters when provided', async () => {
    const { client, captured } = makeFakeSupabase([]);
    const tool = createGetEpisodeTimelineTool({ supabase: client });
    await tool.handler(
      {
        from: FROM,
        to: TO,
        source_types: ['meal', 'transaction'],
        participant_node_id: NODE,
      },
      memberCtx(),
    );
    expect(captured.filters).toContainEqual({
      op: 'in',
      column: 'source_type',
      value: ['meal', 'transaction'],
    });
    expect(captured.filters).toContainEqual({
      op: 'contains',
      column: 'participants',
      value: [NODE],
    });
  });

  it('short-circuits on a degenerate window', async () => {
    const { client, captured } = makeFakeSupabase([]);
    const tool = createGetEpisodeTimelineTool({ supabase: client });
    const res = await tool.handler({ from: TO, to: FROM }, memberCtx());
    expect(JSON.parse(res.content[0]?.text ?? '{}')).toEqual({ episodes: [] });
    expect(captured.filters).toHaveLength(0);
  });

  it('rejects non-UUID participant_node_id', async () => {
    const { client } = makeFakeSupabase([]);
    const tool = createGetEpisodeTimelineTool({ supabase: client });
    await expect(
      tool.handler({ from: FROM, to: TO, participant_node_id: 'nope' }, memberCtx()),
    ).rejects.toThrow();
  });

  it('rejects unknown source_type values', async () => {
    const { client } = makeFakeSupabase([]);
    const tool = createGetEpisodeTimelineTool({ supabase: client });
    await expect(
      tool.handler({ from: FROM, to: TO, source_types: ['wrong'] }, memberCtx()),
    ).rejects.toThrow();
  });
});
