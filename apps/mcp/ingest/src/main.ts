/**
 * `mcp-ingest` MCP server entrypoint.
 *
 * Streamable-HTTP transport on Railway; mirrors `mcp-homehub-core` with
 * a separate service name and (eventually) a separate tool catalog.
 */

import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';

import { loadEnv } from '@homehub/shared';
import {
  createLogger,
  initTracing,
  onShutdown,
  runWorker,
  workerRuntimeEnvSchema,
} from '@homehub/worker-runtime';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { createServer as createMcpServer } from './handler.js';

const SERVICE_NAME = 'mcp-ingest';

const env = loadEnv(workerRuntimeEnvSchema);
const log = createLogger(env, { service: SERVICE_NAME, component: 'main' });

const exitCode = await runWorker(
  async () => {
    initTracing(env);

    const mcp = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    // The SDK's Transport interface uses optional properties that aren't
    // declared `| undefined`; that clashes with our exactOptionalPropertyTypes
    // setting. Cast here rather than relax the TS config — the constructor
    // above is the true shape check.
    await mcp.connect(transport as unknown as Parameters<typeof mcp.connect>[0]);

    let ready = false;
    const port = Number.parseInt(process.env.PORT ?? '8080', 10);

    const server = createHttpServer(async (req, res) => {
      const url = req.url ?? '/';
      if (url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', service: SERVICE_NAME }));
        return;
      }
      if (url === '/ready') {
        res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: ready ? 'ready' : 'starting', service: SERVICE_NAME }));
        return;
      }
      if (url === '/mcp' || url.startsWith('/mcp?') || url.startsWith('/mcp/')) {
        try {
          await transport.handleRequest(req, res);
        } catch (err) {
          log.error('streamable http transport error', { err });
          if (!res.headersSent) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'transport_error' }));
          }
        }
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, () => {
        server.off('error', reject);
        resolve();
      });
    });
    log.info('mcp http transport listening', { port });

    onShutdown(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await mcp.close();
    });

    ready = true;

    // TODO(@integrations, M4+): register ingest tools per the provider
    // rollouts in specs/03-integrations/*.
    await new Promise<void>((resolve) => {
      const onSig = (): void => resolve();
      process.once('SIGTERM', onSig);
      process.once('SIGINT', onSig);
    });
  },
  { shutdownTimeoutMs: 30_000 },
);

process.exit(exitCode);
