/**
 * `node-regen` worker entrypoint (M3-B).
 *
 * Polls `node_regen`, claims messages, and dispatches to
 * `pollOnce` in `./handler.ts`. Wires the runtime's env, Supabase,
 * queue client, logger, and the OpenRouter-backed model client.
 *
 * The model client is required — this worker calls it on every
 * non-stub regeneration. If `OPENROUTER_API_KEY` is not set the
 * worker logs at startup and stays un-ready; healthcheck reports
 * `not_ready` so Railway drains the instance.
 */

import { createServer } from 'node:http';

import { loadEnv } from '@homehub/shared';
import {
  createLogger,
  createModelClient,
  createQueueClient,
  createServiceClient,
  initTracing,
  onShutdown,
  runWorker,
  workerRuntimeEnvSchema,
} from '@homehub/worker-runtime';

import { pollOnce } from './handler.js';

const SERVICE_NAME = 'worker-node-regen';

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

    if (!env.OPENROUTER_API_KEY) {
      log.error('OPENROUTER_API_KEY is not set; worker will not claim jobs');
      // Stay un-ready so Railway drains.
      await new Promise<void>((resolve) => {
        const onSig = (): void => resolve();
        process.once('SIGTERM', onSig);
        process.once('SIGINT', onSig);
      });
      return;
    }

    const modelClient = createModelClient(env, { logger: log, supabase });

    // Readiness probe: cheap head-count on mem.node.
    try {
      const { error } = await supabase
        .schema('mem')
        .from('node')
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
        const outcome = await pollOnce({ supabase, queues, log, modelClient });
        if (outcome === 'idle') {
          await sleep(IDLE_POLL_DELAY_MS, () => stopping);
        }
      } catch (err) {
        log.error('node-regen pollOnce threw', {
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(ERROR_POLL_DELAY_MS, () => stopping);
      }
    }
    log.info('node-regen main loop exited');
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
