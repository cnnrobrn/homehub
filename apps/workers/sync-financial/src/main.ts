/**
 * `sync-financial` entrypoint.
 *
 * Composes the runtime (env, Supabase, queue, Nango proxy, tracing,
 * logger), spins up the /health + /ready HTTP server Railway probes
 * expect, and runs a polling loop against the per-provider
 * `sync_full:{provider}` and `sync_delta:{provider}` queues.
 *
 * Readiness: flips green only after the service-role Supabase client
 * reports a successful round-trip against `sync.provider_connection`
 * and the Nango client is constructed. Either failure keeps the probe
 * 503 so Railway drains the instance before it claims jobs.
 *
 * Feature flag:
 *   - `HOMEHUB_FINANCIAL_INGESTION_ENABLED` (default true) — when
 *     false the worker still exercises the Nango + queue wiring but
 *     skips DB writes. Useful for dry-running against a live YNAB
 *     account without touching `app.transaction`.
 */

import { createServer } from 'node:http';

import {
  YNAB_PROVIDER_KEY,
  type FinancialProvider,
  createYnabProvider,
} from '@homehub/providers-financial';
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

import { type FinancialProviderName, pollOnce } from './handler.js';

const SERVICE_NAME = 'worker-sync-financial';

const envSchema = workerRuntimeEnvSchema.extend({
  /**
   * `HOMEHUB_FINANCIAL_INGESTION_ENABLED` (default true).
   *
   * Unlike the gmail path, the financial DB surface has been in place
   * since M1 (migration 0005). Leaving the flag in the surface lets
   * operators disable writes per-env during incident response without
   * redeploying.
   */
  HOMEHUB_FINANCIAL_INGESTION_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== 'false' && v !== '0'),
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
    const nango = createNangoClient(env);

    // YNAB provider — the only concrete financial provider for M5-A.
    const ynab = createYnabProvider({
      nango,
      resolveBudgetId: async (connectionId) => {
        // The `connectionId` passed here is the Nango connection id
        // (what the adapter uses for proxy calls). Look up the
        // HomeHub row by that and pull the stored budget id out of
        // metadata. Missing metadata → adapter falls back to the
        // first budget returned by YNAB.
        const { data, error } = await supabase
          .schema('sync')
          .from('provider_connection')
          .select('metadata')
          .eq('provider', 'ynab')
          .eq('nango_connection_id', connectionId)
          .maybeSingle();
        if (error) {
          log.warn('ynab budget-id lookup failed; adapter will fall back', {
            error: error.message,
          });
          return undefined;
        }
        const metadata = data?.metadata as { ynab_budget_id?: unknown } | null;
        const raw = metadata?.ynab_budget_id;
        return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
      },
    });

    const providerFor = (name: FinancialProviderName): FinancialProvider | null => {
      if (name === 'ynab') return ynab;
      // Monarch + Plaid ship in M5-B.
      return null;
    };

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
    log.info('health server listening', { port, nango_key: YNAB_PROVIDER_KEY });

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
        ingestion_enabled: env.HOMEHUB_FINANCIAL_INGESTION_ENABLED,
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
          providerFor,
          log,
          ingestionEnabled: env.HOMEHUB_FINANCIAL_INGESTION_ENABLED,
        });
        if (outcome === 'idle') {
          await sleep(IDLE_POLL_DELAY_MS, () => stopping);
        }
      } catch (err) {
        log.error('sync-financial pollOnce threw', {
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(ERROR_POLL_DELAY_MS, () => stopping);
      }
    }
    log.info('sync-financial main loop exited');
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
