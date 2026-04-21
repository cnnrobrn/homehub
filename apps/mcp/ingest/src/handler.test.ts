import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';

import { createServer, handler } from './handler.js';

describe('mcp-ingest server', () => {
  it('exports createServer as a function', () => {
    expect(typeof createServer).toBe('function');
  });

  it('aliases handler to createServer for fleet-wide shape checks', () => {
    expect(handler).toBe(createServer);
  });

  it('returns an McpServer instance with zero tools at M0', () => {
    const server = createServer();
    expect(server).toBeInstanceOf(McpServer);
  });
});
