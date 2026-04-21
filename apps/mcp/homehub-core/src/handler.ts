/**
 * `homehub-core` MCP server bootstrap.
 *
 * Registers the four M3-C tools:
 *   - `query_memory`         — hybrid memory retrieval (via
 *                              `@homehub/query-memory`).
 *   - `list_events`          — read-only calendar window.
 *   - `get_node`             — one memory node + its neighborhood.
 *   - `get_episode_timeline` — time-ordered episode slice.
 *
 * Every tool's handler is wrapped so it receives an `AuthContext`
 * resolved from the transport-level `req.auth` (see `src/main.ts`).
 * The tool modules themselves are agnostic to the MCP SDK shape — the
 * registration wiring here adapts between the SDK callback contract
 * and each tool's `(input, ctx) => Promise<ToolResult>` shape.
 *
 * Returning a factory keeps tests simple and mirrors the SDK's
 * recommended usage pattern.
 */

import { type QueryMemoryClient } from '@homehub/query-memory';
import { type ServiceSupabaseClient } from '@homehub/worker-runtime';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type ZodType } from 'zod';

import { ForbiddenError, InvalidTokenError, NotFoundError } from './errors.js';
import { type AuthContext } from './middleware/auth.js';
import { createGetEpisodeTimelineTool } from './tools/getEpisodeTimeline.js';
import { createGetNodeTool } from './tools/getNode.js';
import { createListEventsTool } from './tools/listEvents.js';
import { createQueryMemoryTool } from './tools/queryMemory.js';
import { errorResult, type ToolResult } from './tools/result.js';

const SERVER_NAME = 'homehub-core';
const SERVER_VERSION = '0.1.0';

export interface CreateServerDeps {
  supabase: ServiceSupabaseClient;
  queryMemory: QueryMemoryClient;
  /**
   * Resolves the `AuthContext` for the in-flight request. In
   * production this reads `extra.authInfo.extra.context` populated by
   * the HTTP-level middleware (`src/main.ts`). Tests inject a stub.
   */
  resolveAuth: (extra: { authInfo?: { extra?: Record<string, unknown> } }) => AuthContext;
}

/**
 * Shape every tool module exposes. Tools are framework-agnostic;
 * this adapter wraps them for the MCP SDK's `registerTool` API.
 * `inputSchema` is a Zod raw shape — a map from field name to a
 * Zod schema — which matches the SDK's `ZodRawShapeCompat`.
 */
interface RegistrableTool {
  name: string;
  description: string;
  inputSchema: Record<string, ZodType<unknown>>;
  handler: (input: unknown, ctx: AuthContext) => Promise<ToolResult>;
}

function wrapHandler(
  tool: RegistrableTool,
  resolveAuth: CreateServerDeps['resolveAuth'],
): (
  input: Record<string, unknown>,
  extra: { authInfo?: { extra?: Record<string, unknown> } },
) => Promise<ToolResult> {
  return async (input, extra) => {
    try {
      const ctx = resolveAuth(extra);
      return await tool.handler(input, ctx);
    } catch (err) {
      if (
        err instanceof InvalidTokenError ||
        err instanceof ForbiddenError ||
        err instanceof NotFoundError
      ) {
        return errorResult(err.message, err.code);
      }
      // Unknown error — surface a generic structured error rather
      // than crashing the transport. `main.ts` logs the raw exception
      // at the HTTP layer separately.
      const message = err instanceof Error ? err.message : String(err);
      return errorResult(message, 'MCP_TOOL_ERROR');
    }
  };
}

export function createServer(deps: CreateServerDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  const tools: RegistrableTool[] = [
    createQueryMemoryTool({ queryMemory: deps.queryMemory }) as RegistrableTool,
    createListEventsTool({ supabase: deps.supabase }) as RegistrableTool,
    createGetNodeTool({ supabase: deps.supabase }) as RegistrableTool,
    createGetEpisodeTimelineTool({ supabase: deps.supabase }) as RegistrableTool,
  ];

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      // SDK typing for `registerTool` is parameterised on the Zod
      // raw shape; we've already narrowed at the tool module's
      // exports. The cast keeps us from declaring an unsafe `any`
      // and mirrors the SDK's advertised `ZodRawShapeCompat` shape.
      wrapHandler(tool, deps.resolveAuth) as Parameters<McpServer['registerTool']>[2],
    );
  }

  return server;
}

/**
 * Alias kept so the worker-fleet handler-shape test can import
 * `handler` and assert it's a function.
 */
export const handler = createServer;

export const TOOL_NAMES = {
  queryMemory: 'query_memory',
  listEvents: 'list_events',
  getNode: 'get_node',
  getEpisodeTimeline: 'get_episode_timeline',
} as const;
