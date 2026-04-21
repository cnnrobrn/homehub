/**
 * `mcp-homehub-core` MCP server entrypoint.
 *
 * Runs behind a streamable-HTTP transport on Railway. The server
 * registers the M3-C tool catalog (`query_memory`, `list_events`,
 * `get_node`, `get_episode_timeline`) and validates every request's
 * `Authorization` bearer token at the HTTP layer via
 * `createAuthMiddleware`. The resolved `AuthContext` is attached to
 * the Node HTTP request under `req.auth.extra.context`, which the
 * transport forwards to the tool handlers as `extra.authInfo`.
 *
 * Auth failure → HTTP 401 and we never forward the request to the MCP
 * transport. Scope failure → HTTP 403. Everything else (including
 * `NotYetImplementedError` for the production pre-migration path) is
 * treated as a 501 so callers see the upgrade path.
 *
 * Specs:
 *   - `specs/03-integrations/mcp.md`
 *   - `specs/04-memory-network/retrieval.md`
 *   - `specs/13-conversation/tools.md`
 */

import { randomUUID } from 'node:crypto';
import { type IncomingMessage, createServer as createHttpServer } from 'node:http';

import { createQueryMemory } from '@homehub/query-memory';
import { loadEnv } from '@homehub/shared';
import {
  createLogger,
  createModelClient,
  createServiceClient,
  initTracing,
  NotYetImplementedError,
  onShutdown,
  runWorker,
} from '@homehub/worker-runtime';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { mcpCoreEnvSchema } from './env.js';
import { ForbiddenError, InvalidTokenError } from './errors.js';
import { createServer as createMcpServer } from './handler.js';
import { type AuthContext, createAuthMiddleware } from './middleware/auth.js';

const SERVICE_NAME = 'mcp-homehub-core';

interface AuthedRequest extends IncomingMessage {
  auth?: {
    token: string;
    clientId: string;
    scopes: string[];
    extra: { context: AuthContext };
  };
}

function toHeaderMap(req: IncomingMessage): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = v[0];
    }
  }
  return out;
}

const env = loadEnv(mcpCoreEnvSchema);
const log = createLogger(env, { service: SERVICE_NAME, component: 'main' });

const exitCode = await runWorker(
  async () => {
    initTracing(env);

    const supabase = createServiceClient(env);
    const modelClient = createModelClient(env, {
      logger: log.child({ component: 'model-client' }),
      supabase,
    });
    const queryMemory = createQueryMemory({
      supabase,
      modelClient,
      log: log.child({ component: 'query-memory' }),
    });
    const auth = createAuthMiddleware({ env });

    const mcp = createMcpServer({
      supabase,
      queryMemory,
      resolveAuth: (extra) => {
        // The transport forwards `req.auth` as `extra.authInfo`; we
        // stashed the validated `AuthContext` under `extra.context`
        // when we accepted the request. Missing = programmer error;
        // surface loudly.
        const ctx = extra.authInfo?.extra?.['context'] as AuthContext | undefined;
        if (!ctx) {
          throw new InvalidTokenError('no auth context on request');
        }
        return ctx;
      },
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    // SDK's Transport interface uses optional properties that aren't
    // declared `| undefined`; that clashes with our
    // exactOptionalPropertyTypes setting. Cast here rather than relax
    // the TS config — the constructor above is the true shape check.
    await mcp.connect(transport as unknown as Parameters<typeof mcp.connect>[0]);

    let ready = false;
    const port = Number.parseInt(process.env['PORT'] ?? '8080', 10);

    const httpServer = createHttpServer(async (req: AuthedRequest, res) => {
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
        // --- Auth ---------------------------------------------------
        let ctx: AuthContext;
        try {
          ctx = auth.authenticate(toHeaderMap(req));
        } catch (err) {
          if (err instanceof InvalidTokenError) {
            res.writeHead(401, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: { code: err.code, message: err.message } }));
            return;
          }
          if (err instanceof ForbiddenError) {
            res.writeHead(403, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: { code: err.code, message: err.message } }));
            return;
          }
          if (err instanceof NotYetImplementedError) {
            res.writeHead(501, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: { code: err.code, message: err.message } }));
            return;
          }
          log.error('mcp auth failed with unexpected error', { err });
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'MCP_AUTH_ERROR', message: 'auth failed' } }));
          return;
        }

        req.auth = {
          token: 'redacted',
          clientId: ctx.kind === 'member' ? ctx.memberId : ctx.serviceName,
          scopes: [...ctx.scopes],
          extra: { context: ctx },
        };

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
      httpServer.once('error', reject);
      httpServer.listen(port, () => {
        httpServer.off('error', reject);
        resolve();
      });
    });
    log.info('mcp http transport listening', { port });

    onShutdown(async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await mcp.close();
    });

    ready = true;

    await new Promise<void>((resolve) => {
      const onSig = (): void => resolve();
      process.once('SIGTERM', onSig);
      process.once('SIGINT', onSig);
    });
  },
  { shutdownTimeoutMs: 30_000 },
);

process.exit(exitCode);
