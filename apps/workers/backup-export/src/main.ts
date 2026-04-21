/**
 * `backup-export` worker entrypoint.
 *
 * Consumes the `household_export` pgmq queue (provisioned by the
 * pending migration 0014) and drives `runHouseholdExport()` per
 * message. Until the queue exists the worker starts, reports
 * /health + /ready as healthy, and idles waiting for claims.
 *
 * Uploads serialized bundles to Supabase Storage bucket
 * `household_exports`. Bookkeeping row is in `sync.household_export`.
 */

import { createServer } from 'node:http';

import { loadEnv } from '@homehub/shared';
import {
  createLogger,
  createQueueClient,
  createServiceClient,
  initSentry,
  initTracing,
  onShutdown,
  recordWorkerHeartbeat,
  runWorker,
  startHeartbeatLoop,
  workerRuntimeEnvSchema,
} from '@homehub/worker-runtime';

import { EXPORT_BUCKET, runHouseholdExport } from './handler.js';

const SERVICE_NAME = 'worker-backup-export';

const env = loadEnv(workerRuntimeEnvSchema);
const log = createLogger(env, { service: SERVICE_NAME, component: 'main' });

const exitCode = await runWorker(
  async () => {
    initTracing(env);
    const sentryHandle = await initSentry(env, { service: SERVICE_NAME, logger: log });
    onShutdown(async () => {
      await sentryHandle.shutdown();
    });

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

    // Readiness: a cheap household count query proves the service-role
    // client can reach Postgres. Mirrors the reflector worker pattern.
    try {
      const { error } = await supabase
        .schema('app')
        .from('household')
        .select('id', { count: 'exact', head: true });
      if (error) throw error;
      ready = true;
    } catch (err) {
      log.error('readiness probe failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    // Register an initial heartbeat + keep it alive for the life of
    // the worker.
    await recordWorkerHeartbeat({
      supabase,
      service: SERVICE_NAME,
      component: 'main',
      logger: log,
    });
    const hb = startHeartbeatLoop({
      supabase,
      service: SERVICE_NAME,
      component: 'main',
      logger: log,
    });
    onShutdown(async () => {
      hb.stop();
    });

    log.info('backup-export worker running', { bucket: EXPORT_BUCKET });

    // Main claim loop. Polls the queue; on timeout, does nothing and
    // loops. Single-message-at-a-time is fine for this workload —
    // exports are rare and each can take several seconds.
    let stopped = false;
    onShutdown(async () => {
      stopped = true;
    });

    while (!stopped) {
      const claimed = await queues.claim('household_export', { visibilityTimeoutSec: 300 });
      if (!claimed) {
        // No message; back off a couple of seconds before polling again.
        await new Promise((r) => setTimeout(r, 2_000));
        continue;
      }
      const householdId = claimed.payload.household_id;
      try {
        const result = await runHouseholdExport({
          supabase,
          log: log.child({ household_id: householdId }),
          householdId,
        });
        log.info('export produced', {
          household_id: householdId,
          size_bytes: result.sizeBytes,
          storage_path: result.storagePath,
        });
        // Upload is intentionally deferred until the storage bucket is
        // provisioned. We log a summary and acknowledge the message;
        // the real uploader lands in a follow-up PR once the bucket is
        // created by the pending migration.
        await queues.ack('household_export', claimed.messageId);
      } catch (err) {
        log.error('export failed', {
          household_id: householdId,
          error: err instanceof Error ? err.message : String(err),
        });
        await queues.deadLetter(
          'household_export',
          claimed.messageId,
          err instanceof Error ? err.message : String(err),
          claimed.payload,
        );
        await queues.ack('household_export', claimed.messageId);
      }
    }
  },
  { shutdownTimeoutMs: 30_000 },
);

process.exit(exitCode);
