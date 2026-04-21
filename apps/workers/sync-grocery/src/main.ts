/**
 * `sync-grocery` worker entrypoint.
 *
 * Long-running HTTP server with a pgmq consumer loop. The concrete
 * `GroceryProvider` is selected per connection-row's `provider`
 * column — today only the stub provider is wired; Instacart sits
 * behind the `HOMEHUB_GROCERY_INGESTION_ENABLED` flag until operator
 * credentials land.
 */

import { createServer } from 'node:http';

import {
  type GroceryProvider,
  createInstacartProvider,
  createStubGroceryProvider,
} from '@homehub/providers-grocery';
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

import { type GroceryProviderName, pollOnce } from './handler.js';

const SERVICE_NAME = 'worker-sync-grocery';

const envSchema = workerRuntimeEnvSchema.extend({
  /**
   * `HOMEHUB_GROCERY_INGESTION_ENABLED` (default false).
   *
   * Instacart API access is human-gated; leaving this off lets the
   * worker + queue wiring exercise end-to-end without touching
   * `app.grocery_list`. Flip to true once operator credentials land.
   */
  HOMEHUB_GROCERY_INGESTION_ENABLED: z
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
    const nango = createNangoClient(env);

    // Concrete providers. Instacart throws `InstacartNotConfiguredError`
    // on every call until operator credentials ship; the stub returns
    // empty arrays so the pipeline exercises without a real upstream.
    const instacart = createInstacartProvider({
      nango,
      resolveStoreId: async (connectionId) => {
        const { data } = await supabase
          .schema('sync')
          .from('provider_connection')
          .select('metadata')
          .eq('provider', 'instacart')
          .eq('nango_connection_id', connectionId)
          .maybeSingle();
        const metadata = data?.metadata as { instacart_store_id?: unknown } | null;
        const raw = metadata?.instacart_store_id;
        return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
      },
    });
    const stub = createStubGroceryProvider();

    const providerFor = (name: GroceryProviderName): GroceryProvider | null => {
      if (name === 'instacart') return instacart;
      if (name === 'stub') return stub;
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
        ingestion_enabled: env.HOMEHUB_GROCERY_INGESTION_ENABLED,
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
          ingestionEnabled: env.HOMEHUB_GROCERY_INGESTION_ENABLED,
        });
        if (outcome === 'idle') {
          await sleep(IDLE_POLL_DELAY_MS, () => stopping);
        }
      } catch (err) {
        log.error('sync-grocery pollOnce threw', {
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(ERROR_POLL_DELAY_MS, () => stopping);
      }
    }
    log.info('sync-grocery main loop exited');
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
