/**
 * `sync-financial` worker entrypoint.
 *
 * M0 scaffold. The runtime wires up env, tracing, Supabase, and the queue
 * client; the handler body is still a stub. This file mirrors the
 * template in sibling worker services under apps/workers/*.
 */

import { createServer } from 'node:http';

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

const SERVICE_NAME = 'worker-sync-financial';

const env = loadEnv(workerRuntimeEnvSchema);
const log = createLogger(env, { service: SERVICE_NAME, component: 'main' });

const exitCode = await runWorker(
  async () => {
    initTracing(env);
    const supabase = createServiceClient(env);
    const queues = createQueueClient(supabase);

    // Health/ready HTTP server per specs/05-agents/workers.md.
    let ready = false;
    const port = Number.parseInt(process.env.PORT ?? '8080', 10);
    const server = createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', service: SERVICE_NAME }));
        return;
      }
      if (req.url === '/ready') {
        res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: ready ? 'ready' : 'starting', service: SERVICE_NAME }));
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
    log.info('health server listening', { port });

    onShutdown(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    // The queue client is constructed so readiness reflects a working
    // Supabase connection. The real consumer loop lands later.
    void queues;
    ready = true;

    log.info('worker started (no-op loop)');
    // TODO(@integrations, M5): replace with pgmq consumer for the sync_financial queue.
    await new Promise<void>((resolve) => {
      const onSig = (): void => resolve();
      process.once('SIGTERM', onSig);
      process.once('SIGINT', onSig);
    });
  },
  { shutdownTimeoutMs: 30_000 },
);

process.exit(exitCode);
