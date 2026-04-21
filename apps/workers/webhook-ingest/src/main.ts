/**
 * `webhook-ingest` entrypoint.
 *
 * Unlike the pgmq-consuming workers, this service is an HTTP server.
 * It terminates TLS at Railway's edge, verifies the provider signature,
 * and enqueues a fan-out message for the matching `sync-*` worker.
 *
 * Routes:
 *   - GET  /health                         → 200 liveness
 *   - GET  /ready                          → 200/503 readiness
 *   - POST /webhooks/google-calendar       → delegated to `handleGoogleCalendarWebhook`
 *   - POST /webhooks/nango                 → delegated to `handleNangoWebhook`
 *
 * Everything else falls through to 404.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { createGoogleCalendarProvider } from '@homehub/providers-calendar';
import { loadEnv } from '@homehub/shared';
import {
  createLogger,
  createNangoClient,
  createQueueClient,
  createServiceClient,
  initTracing,
  onShutdown,
  runWorker,
  workerRuntimeEnvSchema,
} from '@homehub/worker-runtime';
import { z } from 'zod';

import {
  handleGoogleCalendarWebhook,
  handleNangoWebhook,
  type WebhookIngestDeps,
} from './handler.js';

const SERVICE_NAME = 'worker-webhook-ingest';

// Extend the runtime schema with our provider-webhook secrets. We keep
// them optional so the service can boot in environments where only some
// providers are wired up; per-route handlers fail-loud if a secret they
// need is missing.
const envSchema = workerRuntimeEnvSchema.extend({
  NANGO_WEBHOOK_SECRET: z.string().min(1).optional(),
  WEBHOOK_PUBLIC_URL: z.string().url().optional(),
});

const env = loadEnv(envSchema);
const log = createLogger(env, { service: SERVICE_NAME, component: 'main' });

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

const exitCode = await runWorker(
  async () => {
    initTracing(env);
    const supabase = createServiceClient(env);
    const queues = createQueueClient(supabase);
    const nango = createNangoClient(env);
    const calendar = createGoogleCalendarProvider({ nango });

    const deps: WebhookIngestDeps = {
      supabase,
      queues,
      calendar,
      log,
      env: {
        ...(env.NANGO_WEBHOOK_SECRET ? { NANGO_WEBHOOK_SECRET: env.NANGO_WEBHOOK_SECRET } : {}),
        ...(env.WEBHOOK_PUBLIC_URL ? { WEBHOOK_PUBLIC_URL: env.WEBHOOK_PUBLIC_URL } : {}),
      },
    };

    let ready = false;
    const port = Number.parseInt(process.env.PORT ?? '8080', 10);
    const server = createServer((req, res) => {
      void route(req, res).catch((err) => {
        log.error('unhandled route error', {
          error: err instanceof Error ? err.message : String(err),
        });
        try {
          writeJson(res, 500, { error: 'internal error' });
        } catch {
          /* response already started */
        }
      });
    });

    async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const url = req.url ?? '/';
      if (url === '/health') {
        writeJson(res, 200, { status: 'ok', service: SERVICE_NAME });
        return;
      }
      if (url === '/ready') {
        writeJson(res, ready ? 200 : 503, {
          status: ready ? 'ready' : 'starting',
          service: SERVICE_NAME,
        });
        return;
      }
      if (req.method !== 'POST') {
        writeJson(res, 404, { error: 'not found' });
        return;
      }
      if (url === '/webhooks/google-calendar' || url.startsWith('/webhooks/google-calendar?')) {
        // Google sends a 0-byte body on most notifications. Don't parse.
        // Drain anyway so the connection closes cleanly.
        await readRawBody(req);
        const result = await handleGoogleCalendarWebhook(deps, {
          headers: req.headers,
        });
        writeJson(res, result.status, result.body);
        return;
      }
      if (url === '/webhooks/nango' || url.startsWith('/webhooks/nango?')) {
        const rawBody = await readRawBody(req);
        const result = await handleNangoWebhook(deps, { headers: req.headers, rawBody });
        writeJson(res, result.status, result.body);
        return;
      }
      writeJson(res, 404, { error: 'not found' });
    }

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, () => {
        server.off('error', reject);
        resolve();
      });
    });
    log.info('webhook ingress listening', { port });

    onShutdown(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    // Readiness: verify Supabase reachability.
    try {
      const { error } = await supabase
        .schema('sync')
        .from('provider_connection')
        .select('id', { count: 'exact', head: true });
      if (error) throw error;
      ready = true;
      log.info('readiness ok; accepting webhooks');
    } catch (err) {
      log.error('readiness probe failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Wait for shutdown signal — the server callbacks keep the loop busy.
    await new Promise<void>((resolve) => {
      const onSig = (): void => resolve();
      process.once('SIGTERM', onSig);
      process.once('SIGINT', onSig);
    });
  },
  { shutdownTimeoutMs: 30_000 },
);

process.exit(exitCode);
