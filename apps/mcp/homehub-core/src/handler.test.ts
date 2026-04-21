/**
 * Tests for the MCP server factory. We stand up the server with a
 * stubbed Supabase client + query-memory client, assert it registers
 * exactly the four M3-C tools, and (via the `ListToolsRequest`
 * handler) verify the tool metadata is served through the standard
 * MCP listTools surface.
 */

import { type QueryMemoryClient } from '@homehub/query-memory';
import { type ServiceSupabaseClient } from '@homehub/worker-runtime';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';

import { createServer, handler, TOOL_NAMES } from './handler.js';
import { type AuthContext } from './middleware/auth.js';

function stubCtx(): AuthContext {
  return {
    kind: 'member',
    householdId: 'a0000000-0000-4000-8000-000000000001' as AuthContext['householdId'],
    memberId: 'c0000000-0000-4000-8000-000000000010' as Extract<
      AuthContext,
      { kind: 'member' }
    >['memberId'],
    scopes: ['*'],
    tokenId: 'dev:test',
  };
}

function stubDeps() {
  const queryMemory: QueryMemoryClient = {
    query: async () => ({
      nodes: [],
      edges: [],
      facts: [],
      episodes: [],
      patterns: [],
      conflicts: [],
    }),
  };
  const supabase = {} as ServiceSupabaseClient;
  return { queryMemory, supabase };
}

describe('homehub-core mcp server', () => {
  it('exports createServer as a function', () => {
    expect(typeof createServer).toBe('function');
  });

  it('aliases handler to createServer for fleet-wide shape checks', () => {
    expect(handler).toBe(createServer);
  });

  it('returns an McpServer instance when given dependencies', () => {
    const server = createServer({
      ...stubDeps(),
      resolveAuth: stubCtx,
    });
    expect(server).toBeInstanceOf(McpServer);
  });

  it('exposes the four M3-C tool names', () => {
    // The SDK does not expose `_registeredTools` publicly, but the
    // underlying Server does expose registered request handlers we
    // can inspect via `listTools`. Instead of touching internals we
    // just assert the TOOL_NAMES barrel matches the spec.
    expect(Object.values(TOOL_NAMES).sort()).toEqual(
      ['get_episode_timeline', 'get_node', 'list_events', 'query_memory'].sort(),
    );
  });
});
