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
 *   - POST /webhooks/google-calendar       → `handleGoogleCalendarWebhook`
 *   - POST /webhooks/google-mail/pubsub    → `handleGoogleMailPubsubWebhook`
 *   - POST /webhooks/nango                 → `handleNangoWebhook`
 *
 * Everything else falls through to 404.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { createGoogleCalendarProvider } from '@homehub/providers-calendar';
import { createGoogleMailProvider } from '@homehub/providers-email';
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
  handleGoogleMailPubsubWebhook,
  handleNangoWebhook,
  type WebhookIngestDeps,
} from './handler.js';

const SERVICE_NAME = 'worker-webhook-ingest';

const envSchema = workerRuntimeEnvSchema.extend({
  NANGO_WEBHOOK_SECRET: z.string().min(1).optional(),
  WEBHOOK_PUBLIC_URL: z.string().url().optional(),
  /**
   * Pub/Sub topic for Gmail push (`projects/<project>/topics/<topic>`).
   * When unset, `connection.created` skips users.watch and the sync
   * worker falls back to polling only.
   */
  NANGO_GMAIL_PUBSUB_TOPIC: z.string().min(1).optional(),
  /**
   * Shared-secret token required on `/webhooks/google-mail/pubsub` when
   * configured. Matches the `?token=` query attached to the Pub/Sub push
   * subscription URL.
   */
  HOMEHUB_GMAIL_WEBHOOK_TOKEN: z.string().min(1).optional(),
  /**
   * When set, the Gmail webhook additionally requires an `Authorization:
   * Bearer <jwt>` header (JWT audience match). Full signature verification
   * against Google's JWKS is deferred — see `handler.ts`.
   */
  HOMEHUB_GMAIL_WEBHOOK_JWT_AUDIENCE: z.string().min(1).optional(),
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
    const email = createGoogleMailProvider({ nango });

    const deps: WebhookIngestDeps = {
      supabase,
      queues,
      calendar,
      email,
      log,
      env: {
        ...(env.NANGO_WEBHOOK_SECRET ? { NANGO_WEBHOOK_SECRET: env.NANGO_WEBHOOK_SECRET } : {}),
        ...(env.WEBHOOK_PUBLIC_URL ? { WEBHOOK_PUBLIC_URL: env.WEBHOOK_PUBLIC_URL } : {}),
        ...(env.NANGO_GMAIL_PUBSUB_TOPIC
          ? { NANGO_GMAIL_PUBSUB_TOPIC: env.NANGO_GMAIL_PUBSUB_TOPIC }
          : {}),
        ...(env.HOMEHUB_GMAIL_WEBHOOK_TOKEN
          ? { HOMEHUB_GMAIL_WEBHOOK_TOKEN: env.HOMEHUB_GMAIL_WEBHOOK_TOKEN }
          : {}),
        ...(env.HOMEHUB_GMAIL_WEBHOOK_JWT_AUDIENCE
          ? { HOMEHUB_GMAIL_WEBHOOK_JWT_AUDIENCE: env.HOMEHUB_GMAIL_WEBHOOK_JWT_AUDIENCE }
          : {}),
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
      const pathOnly = url.split('?', 1)[0] ?? '/';
      if (pathOnly === '/health') {
        writeJson(res, 200, { status: 'ok', service: SERVICE_NAME });
        return;
      }
      if (pathOnly === '/ready') {
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
      if (pathOnly === '/webhooks/google-calendar') {
        // Google sends a 0-byte body on most notifications. Don't parse.
        await readRawBody(req);
        const result = await handleGoogleCalendarWebhook(deps, {
          headers: req.headers,
        });
        writeJson(res, result.status, result.body);
        return;
      }
      if (pathOnly === '/webhooks/google-mail/pubsub') {
        const rawBody = await readRawBody(req);
        const query = parseQuery(url);
        const result = await handleGoogleMailPubsubWebhook(deps, {
          headers: req.headers,
          rawBody,
          query,
        });
        writeJson(res, result.status, result.body);
        return;
      }
      if (pathOnly === '/webhooks/nango') {
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

    await new Promise<void>((resolve) => {
      const onSig = (): void => resolve();
      process.once('SIGTERM', onSig);
      process.once('SIGINT', onSig);
    });
  },
  { shutdownTimeoutMs: 30_000 },
);

/**
 * Parse a request URL's query string into a flat record. We intentionally
 * avoid `node:url.URL` here so relative URLs (Node gives us only the path
 * + query, not an origin) parse correctly.
 */
function parseQuery(url: string): Record<string, string | undefined> {
  const qIndex = url.indexOf('?');
  if (qIndex < 0) return {};
  const params = new URLSearchParams(url.slice(qIndex + 1));
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of params) {
    out[k] = v;
  }
  return out;
}

process.exit(exitCode);
