/**
 * `action-executor` worker entrypoint.
 *
 * Two sibling claim loops run in the same process:
 *
 *   1. `execute_action`  — dispatches to the kind-keyed executor registry.
 *                           M9-A ships with an empty registry; every
 *                           kind DLQs with UnknownActionKindError until
 *                           M9-B registers provider-backed executors.
 *
 *   2. `evaluate_suggestion_approval` — auto-approval evaluator.
 *                           Suggestions whose policy's `autoApproveWhen`
 *                           predicate returns true are approved +
 *                           dispatched without a human tap. Destructive
 *                           kinds can never be auto-approved (enforced
 *                           in `@homehub/approval-flow`).
 *
 * Readiness: a cheap head-count against `app.action` confirms the DB
 * connection before we flip the `/ready` probe green.
 *
 * Graceful shutdown: the claim loops stop on the next cycle; in-flight
 * messages finish processing before the drain completes, because we
 * only set the `stopping` flag and never interrupt a handler.
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

import { pollOnceEvaluate } from './evaluate-handler.js';
import { pollOnceExecute } from './execute-handler.js';

const SERVICE_NAME = 'worker-action-executor';

const IDLE_POLL_DELAY_MS = 2_000;
const ERROR_POLL_DELAY_MS = 5_000;

const env = loadEnv(workerRuntimeEnvSchema);
const log = createLogger(env, { service: SERVICE_NAME, component: 'main' });

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

    // Readiness: a cheap head-count against app.action. If this fails
    // we stay un-ready and Railway drains us.
    try {
      const { error } = await supabase
        .schema('app')
        .from('action')
        .select('id', { count: 'exact', head: true });
      if (error) throw error;
      ready = true;
      log.info('readiness ok; entering poll loop');
    } catch (err) {
      log.error('readiness probe failed; worker will not claim jobs', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    while (!stopping) {
      try {
        const outcomes = await Promise.all([
          pollOnceExecute({ supabase, queues, log }),
          pollOnceEvaluate({ supabase, queues, log }),
        ]);
        const anyClaimed = outcomes.some((o) => o === 'claimed');
        if (!anyClaimed) {
          await sleep(IDLE_POLL_DELAY_MS, () => stopping);
        }
      } catch (err) {
        log.error('action-executor pollOnce threw', {
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(ERROR_POLL_DELAY_MS, () => stopping);
      }
    }
    log.info('action-executor main loop exited');
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
