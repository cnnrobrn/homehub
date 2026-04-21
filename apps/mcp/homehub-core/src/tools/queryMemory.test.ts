/**
 * Tests for the `query_memory` tool adapter.
 *
 * The adapter is thin — it parses input, forwards `householdId` from
 * the auth context, and serializes the upstream `QueryMemoryResult`.
 * We mock the query-memory client and verify (1) the forwarded args,
 * (2) the JSON envelope, and (3) bad-input rejection.
 */

import { type QueryMemoryClient, type QueryMemoryResult } from '@homehub/query-memory';
import { describe, expect, it, vi } from 'vitest';

import { type AuthContext } from '../middleware/auth.js';

import { createQueryMemoryTool } from './queryMemory.js';

const HOUSEHOLD = 'a0000000-0000-4000-8000-000000000001';
const MEMBER = 'c0000000-0000-4000-8000-000000000010';

function memberCtx(): AuthContext {
  return {
    kind: 'member',
    householdId: HOUSEHOLD as AuthContext['householdId'],
    memberId: MEMBER as Extract<AuthContext, { kind: 'member' }>['memberId'],
    scopes: ['*'],
    tokenId: 'dev:test',
  };
}

function emptyResult(): QueryMemoryResult {
  return { nodes: [], edges: [], facts: [], episodes: [], patterns: [], conflicts: [] };
}

describe('createQueryMemoryTool', () => {
  it('forwards the auth-context household_id and input to query-memory', async () => {
    const query = vi.fn<QueryMemoryClient['query']>(async () => emptyResult());
    const client: QueryMemoryClient = { query };
    const tool = createQueryMemoryTool({ queryMemory: client });

    const res = await tool.handler(
      {
        query: 'what do we know about sarah?',
        layers: ['semantic'],
        types: ['person'],
        include_documents: true,
        include_conflicts: false,
        max_depth: 2,
        limit: 5,
      },
      memberCtx(),
    );

    expect(query).toHaveBeenCalledTimes(1);
    const firstCall = query.mock.calls[0];
    if (!firstCall) throw new Error('expected at least one call');
    const forwarded = firstCall[0];
    expect(forwarded).toMatchObject({
      householdId: HOUSEHOLD,
      query: 'what do we know about sarah?',
      layers: ['semantic'],
      types: ['person'],
      include_documents: true,
      include_conflicts: false,
      max_depth: 2,
      limit: 5,
    });

    expect(res.content[0]?.mimeType).toBe('application/json');
    expect(JSON.parse(res.content[0]?.text ?? '{}')).toEqual(emptyResult());
  });

  it('omits undefined optional fields from the forwarded args', async () => {
    const query = vi.fn<QueryMemoryClient['query']>(async () => emptyResult());
    const tool = createQueryMemoryTool({ queryMemory: { query } });
    await tool.handler({ query: 'anything about allergies?' }, memberCtx());
    const firstCall = query.mock.calls[0];
    if (!firstCall) throw new Error('expected at least one call');
    const forwarded = firstCall[0] as unknown as Record<string, unknown>;
    expect(forwarded).not.toHaveProperty('layers');
    expect(forwarded).not.toHaveProperty('types');
    expect(forwarded).not.toHaveProperty('as_of');
    expect(forwarded).not.toHaveProperty('recency_half_life_days');
    // Schema defaults still land.
    expect(forwarded['include_documents']).toBe(true);
    expect(forwarded['include_conflicts']).toBe(true);
    expect(forwarded['max_depth']).toBe(2);
    expect(forwarded['limit']).toBe(10);
  });

  it('rejects bad input with a structured error message', async () => {
    const query = vi.fn<QueryMemoryClient['query']>(async () => emptyResult());
    const tool = createQueryMemoryTool({ queryMemory: { query } });
    await expect(tool.handler({ query: '' }, memberCtx())).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects unknown node types', async () => {
    const query = vi.fn<QueryMemoryClient['query']>(async () => emptyResult());
    const tool = createQueryMemoryTool({ queryMemory: { query } });
    await expect(
      tool.handler({ query: 'q', types: ['not_a_node_type'] }, memberCtx()),
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
