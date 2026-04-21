/**
 * `reconciler` worker entrypoint.
 *
 * Long-running HTTP server that exposes `/health` + `/ready` for Railway
 * probes and idles until SIGTERM. The actual reconciliation work is
 * driven by the sibling `cron.ts` entry (Railway cron trigger), not by
 * this process. We keep this process running so the service has a
 * long-lived presence for log aggregation + a cheap place to respond
 * to health checks.
 *
 * Feature flag: none — the reconciler is a no-op when there are no
 * `source='email_receipt'` rows, which is today's state.
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

const SERVICE_NAME = 'worker-reconciler';

const env = loadEnv(workerRuntimeEnvSchema);
const log = createLogger(env, { service: SERVICE_NAME, component: 'main' });

const exitCode = await runWorker(
  async () => {
    initTracing(env);
    const supabase = createServiceClient(env);
    const queues = createQueueClient(supabase);

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

    try {
      const { error } = await supabase
        .schema('sync')
        .from('provider_connection')
        .select('id', { count: 'exact', head: true });
      if (error) throw error;
      ready = true;
      log.info('readiness ok; idling (cron-driven)');
    } catch (err) {
      log.error('readiness probe failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // We construct the queue client so readiness reflects a working
    // Supabase connection; the reconciler itself writes directly to
    // app.transaction and does not consume pgmq messages in M5-A.
    void queues;

    await new Promise<void>((resolve) => {
      const onSig = (): void => resolve();
      process.once('SIGTERM', onSig);
      process.once('SIGINT', onSig);
    });
  },
  { shutdownTimeoutMs: 30_000 },
);

process.exit(exitCode);
