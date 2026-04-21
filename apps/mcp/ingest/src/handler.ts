/**
 * `mcp-ingest` MCP server bootstrap.
 *
 * Separated from `mcp-homehub-core` because ingest tools have different
 * trust boundaries — they are primarily called by internal systems and
 * tested provider integrations, not by end-user-facing agents. Keeping
 * them on a distinct server + transport lets us apply stricter network
 * policies and scale them independently.
 *
 * Zero tools registered at M0. @integrations wires push-event,
 * upsert-entity, and re-enrich tools in M4+.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const SERVER_NAME = 'homehub-ingest';
const SERVER_VERSION = '0.0.0';

export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  return server;
}

export const handler = createServer;
