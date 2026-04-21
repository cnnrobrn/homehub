/**
 * `homehub-core` MCP server bootstrap.
 *
 * Exposes a single `createServer()` that returns a freshly-constructed
 * `McpServer` with zero tools registered. @integrations wires the full
 * tool catalog in M3 as @frontend-chat and @memory-background deliver
 * their respective implementations.
 *
 * Returning a factory (instead of a singleton) keeps tests simple and
 * mirrors the SDK's own recommended usage pattern.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const SERVER_NAME = 'homehub-core';
const SERVER_VERSION = '0.0.0';

export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    // No tools yet. @integrations registers them in M3; see
    // specs/13-conversation/tools.md for the catalog.
  );
  return server;
}

/**
 * Alias kept so the worker-fleet handler-shape test can import `handler`
 * and assert it's a function. MCP services don't have a pgmq handler
 * per se — this points at the server factory.
 */
export const handler = createServer;
