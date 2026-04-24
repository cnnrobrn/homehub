/**
 * `sync-gmail` entrypoint.
 *
 * Composes the runtime (env, Supabase, queue, Nango proxy, tracing,
 * logger), spins up the /health + /ready HTTP server Railway probes
 * expect, and runs a polling loop against the per-provider
 * `sync_full:gmail` and `sync_delta:gmail` queues.
 *
 * Readiness: flips green only after the service-role Supabase client
 * reports a successful round-trip against `sync.provider_connection`
 * and the Nango client is constructed. Either failure keeps the probe
 * 503 so Railway drains the instance before it claims jobs.
 *
 * Feature flag:
 *   - `HOMEHUB_EMAIL_INGESTION_ENABLED` (default false) — when false the
 *     worker exercises the Nango + queue wiring but does NOT write to
 *     `app.email` / `app.email_attachment` / Storage. Flip to true once
 *     migration 0012 lands. See `apps/workers/sync-gmail/README.md`.
 */

import { createServer } from 'node:http';

import { createGoogleMailProvider } from '@homehub/providers-email';
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
import { z } from 'zod';

import { pollOnce } from './handler.js';

const SERVICE_NAME = 'worker-sync-gmail';

const envSchema = workerRuntimeEnvSchema.extend({
  /**
   * `HOMEHUB_EMAIL_INGESTION_ENABLED` (default false).
   *
   * When false the worker loop still runs and acks messages so the
   * Nango connect / watch subscription path can be verified against
   * real accounts, but it skips persistence + attachment upload +
   * labeling. Flip to true after migration 0012 (`app.email` +
   * `app.email_attachment` + `email_attachments` bucket) lands and the
   * generated `@homehub/db` types are regenerated.
   */
  HOMEHUB_EMAIL_INGESTION_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

const env = loadEnv(envSchema);
const log = createLogger(env, { service: SERVICE_NAME, component: 'main' });

const IDLE_POLL_DELAY_MS = 2_000;
const ERROR_POLL_DELAY_MS = 5_000;

const exitCode = await runWorker(
  async () => {
    initTracing(env);
    const supabase = createServiceClient(env);
    const queues = createQueueClient(supabase);
    const http = createGoogleProviderHttpClient({ env, supabase, log });
    const email = createGoogleMailProvider({ nango: http });

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
        .schema('sync')
        .from('provider_connection')
        .select('id', { count: 'exact', head: true });
      if (error) throw error;
      ready = true;
      log.info('readiness ok; entering poll loop', {
        ingestion_enabled: env.HOMEHUB_EMAIL_INGESTION_ENABLED,
      });
    } catch (err) {
      log.error('readiness probe failed; worker will not claim jobs', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    while (!stopping) {
      try {
        const outcome = await pollOnce({
          supabase,
          queues,
          email,
          log,
          ingestionEnabled: env.HOMEHUB_EMAIL_INGESTION_ENABLED,
        });
        if (outcome === 'idle') {
          await sleep(IDLE_POLL_DELAY_MS, () => stopping);
        }
      } catch (err) {
        log.error('sync-gmail pollOnce threw', {
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(ERROR_POLL_DELAY_MS, () => stopping);
      }
    }
    log.info('sync-gmail main loop exited');
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
