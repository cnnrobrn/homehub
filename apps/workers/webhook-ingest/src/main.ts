/**
 * `webhook-ingest` entrypoint.
 *
 * Unlike the pgmq-consuming workers, this service is an HTTP server.
 * It terminates TLS at Railway's edge, verifies the provider signature,
 * and enqueues a fan-out message for the matching `sync-*` worker.
 *
 * M0 scaffold. Every `/webhooks/:provider` route returns 501; the
 * `/health` and `/ready` routes are live so Railway probes succeed.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { loadEnv } from '@homehub/shared';
import {
  createLogger,
  createQueueClient,
  createServiceClient,
  initTracing,
  onShutdown,
  runWorker,
  workerRuntimeEnvSchema,
} from '@homehub/worker-runtime';

const SERVICE_NAME = 'worker-webhook-ingest';

const env = loadEnv(workerRuntimeEnvSchema);
const log = createLogger(env, { service: SERVICE_NAME, component: 'main' });

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const webhookRoute = /^\/webhooks\/([A-Za-z0-9_-]+)\/?$/;

function route(req: IncomingMessage, res: ServerResponse, ready: boolean): void {
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
  const match = webhookRoute.exec(url);
  if (match && req.method === 'POST') {
    writeJson(res, 501, {
      error: 'provider ingest not implemented in M0',
      provider: match[1],
      hint: 'see specs/03-integrations/* and @integrations agent briefing',
    });
    return;
  }
  writeJson(res, 404, { error: 'not found' });
}

const exitCode = await runWorker(
  async () => {
    initTracing(env);
    const supabase = createServiceClient(env);
    const queues = createQueueClient(supabase);

    let ready = false;
    const port = Number.parseInt(process.env.PORT ?? '8080', 10);
    const server = createServer((req, res) => route(req, res, ready));

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

    // Queue client holds a Supabase handle; construct it so readiness
    // reflects connectivity. Real per-provider enqueue lands in M2+.
    void queues;
    ready = true;

    // TODO(@integrations, M2+): wire provider-specific verification and
    // fan-out per specs/03-integrations/*.md. See src/hmac.ts for the
    // signature-verification slot and src/handler.ts for dispatch.
    await new Promise<void>((resolve) => {
      const onSig = (): void => resolve();
      process.once('SIGTERM', onSig);
      process.once('SIGINT', onSig);
    });
  },
  { shutdownTimeoutMs: 30_000 },
);

process.exit(exitCode);
