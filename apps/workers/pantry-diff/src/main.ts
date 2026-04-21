/**
 * `pantry-diff` worker entrypoint.
 *
 * Long-running HTTP server. Consumes messages from the `pantry_diff`
 * pgmq queue and, for each enqueued household id, runs the diff once.
 * Cron-driven hourly runs live in `src/cron.ts`.
 */

import { createServer } from 'node:http';

import { loadEnv } from '@homehub/shared';
import {
  createLogger,
  createQueueClient,
  createServiceClient,
  initTracing,
  onShutdown,
  queueNames,
  runWorker,
  workerRuntimeEnvSchema,
} from '@homehub/worker-runtime';

import { runPantryDiffWorker } from './handler.js';

const SERVICE_NAME = 'worker-pantry-diff';

const env = loadEnv(workerRuntimeEnvSchema);
const log = createLogger(env, { service: SERVICE_NAME, component: 'main' });

const IDLE_POLL_DELAY_MS = 2_000;
const ERROR_POLL_DELAY_MS = 5_000;

const exitCode = await runWorker(
  async () => {
    initTracing(env);
    const supabase = createServiceClient(env);
    const queues = createQueueClient(supabase);

    let ready = false;
    let stopping = false;
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
      stopping = true;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    try {
      const { error } = await supabase
        .schema('app')
        .from('household')
        .select('id', { count: 'exact', head: true });
      if (error) throw error;
      ready = true;
      log.info('readiness ok; entering poll loop');
    } catch (err) {
      log.error('readiness probe failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    while (!stopping) {
      try {
        const claimed = await queues.claim(queueNames.pantryDiff);
        if (!claimed) {
          await sleep(IDLE_POLL_DELAY_MS, () => stopping);
          continue;
        }
        const householdId = claimed.payload.household_id;
        try {
          await runPantryDiffWorker({
            supabase,
            log: log.child({
              queue: queueNames.pantryDiff,
              household_id: householdId,
              message_id: claimed.messageId,
            }),
            householdIds: [householdId],
          });
          await queues.ack(queueNames.pantryDiff, claimed.messageId);
        } catch (err) {
          log.error('pantry-diff handler failed', {
            household_id: householdId,
            message_id: claimed.messageId,
            error: err instanceof Error ? err.message : String(err),
          });
          await queues.deadLetter(
            queueNames.pantryDiff,
            claimed.messageId,
            err instanceof Error ? err.message : String(err),
            claimed.payload,
          );
          await queues.ack(queueNames.pantryDiff, claimed.messageId);
        }
      } catch (err) {
        log.error('pantry-diff main loop error', {
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(ERROR_POLL_DELAY_MS, () => stopping);
      }
    }
    log.info('pantry-diff main loop exited');
  },
  { shutdownTimeoutMs: 30_000 },
);

async function sleep(ms: number, cancel: () => boolean): Promise<void> {
  const step = 100;
  let remaining = ms;
  while (remaining > 0 && !cancel()) {
    await new Promise((r) => setTimeout(r, Math.min(step, remaining)));
    remaining -= step;
  }
}

process.exit(exitCode);
