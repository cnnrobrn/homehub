/**
 * `sync-gcal` entrypoint.
 *
 * Composes the runtime (env, Supabase, queue, Nango proxy, tracing,
 * logger), spins up the /health + /ready HTTP server Railway probes
 * expect, and runs a polling loop against the per-provider `sync_full:gcal`
 * and `sync_delta:gcal` queues.
 *
 * Readiness: flips green only after the service-role Supabase client
 * reports a successful round-trip against `sync.provider_connection` and
 * the Nango client is constructed. Either failure keeps the probe 503
 * so Railway drains the instance before it claims jobs.
 */

import { createServer } from 'node:http';

import { createGoogleCalendarProvider } from '@homehub/providers-calendar';
import { loadEnv } from '@homehub/shared';
import {
  createGoogleProviderHttpClient,
  createLogger,
  createQueueClient,
  createServiceClient,
  initTracing,
  onShutdown,
  runWorker,
  workerRuntimeEnvSchema,
} from '@homehub/worker-runtime';

import { pollOnce } from './handler.js';

const SERVICE_NAME = 'worker-sync-gcal';

const env = loadEnv(workerRuntimeEnvSchema);
const log = createLogger(env, { service: SERVICE_NAME, component: 'main' });

const IDLE_POLL_DELAY_MS = 2_000;
const ERROR_POLL_DELAY_MS = 5_000;

const exitCode = await runWorker(
  async () => {
    initTracing(env);
    const supabase = createServiceClient(env);
    const queues = createQueueClient(supabase);
    // Google providers now go through the native `GoogleHttpClient`
    // (refresh tokens live encrypted in `sync.google_connection`). Nango
    // stays on the YNAB path elsewhere; sync-gcal has no non-Google
    // providers so we don't need a Nango client here at all.
    const http = createGoogleProviderHttpClient({ env, supabase, log });
    const calendar = createGoogleCalendarProvider({ nango: http });

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

    // Readiness probe: verify Supabase reachability via a cheap read.
    try {
      const { error } = await supabase
        .schema('sync')
        .from('provider_connection')
        .select('id', { count: 'exact', head: true });
      if (error) throw error;
      ready = true;
      log.info('readiness ok; entering poll loop');
    } catch (err) {
      log.error('readiness probe failed; worker will not claim jobs', {
        error: err instanceof Error ? err.message : String(err),
      });
      // Stay un-ready. Railway will drain us on the ready failure.
    }

    while (!stopping) {
      try {
        const outcome = await pollOnce({ supabase, queues, calendar, log });
        if (outcome === 'idle') {
          await sleep(IDLE_POLL_DELAY_MS, () => stopping);
        }
      } catch (err) {
        // pollOnce itself should not throw — the handler maps every
        // expected failure. Anything that bubbles here is a runtime bug;
        // back off before the next iteration so we don't hot-loop.
        log.error('sync-gcal pollOnce threw', {
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(ERROR_POLL_DELAY_MS, () => stopping);
      }
    }
    log.info('sync-gcal main loop exited');
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
