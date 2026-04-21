/**
 * `consolidator` worker entrypoint.
 *
 * Runs as a Railway cron (see `README.md`). Invocation shape:
 *
 *   pnpm --filter @homehub/worker-consolidator start
 *
 * By default iterates every household in `app.household`. Scope to
 * specific households via the `HOMEHUB_HOUSEHOLD_IDS` env var
 * (comma-separated). Exits 0 on success, 1 on fatal error.
 *
 * A `/health` + `/ready` HTTP server is also started so Railway's
 * health checks don't flap during the cron invocation. `/ready` flips
 * green after the consolidator boots (Supabase round-trip) and the
 * server is torn down on SIGTERM.
 */

import { createServer } from 'node:http';

import { loadEnv, type HouseholdId } from '@homehub/shared';
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

import { runConsolidator } from './handler.js';

const SERVICE_NAME = 'worker-consolidator';

const env = loadEnv(workerRuntimeEnvSchema);
const log = createLogger(env, { service: SERVICE_NAME, component: 'main' });

const exitCode = await runWorker(
  async () => {
    initTracing(env);
    const supabase = createServiceClient(env);
    const queues = createQueueClient(supabase);

    if (!env.OPENROUTER_API_KEY) {
      log.error('consolidator requires OPENROUTER_API_KEY to be set');
      throw new Error('OPENROUTER_API_KEY not configured');
    }
    const modelClient = createModelClient(env, { logger: log, supabase });

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

    // Basic readiness: a cheap head-count against app.household.
    try {
      const { error } = await supabase
        .schema('app')
        .from('household')
        .select('id', { count: 'exact', head: true });
      if (error) throw error;
      ready = true;
    } catch (err) {
      log.error('consolidator readiness probe failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    const householdIds = parseHouseholdIds(process.env.HOMEHUB_HOUSEHOLD_IDS);
    log.info('consolidator run starting', {
      household_scope: householdIds.length === 0 ? 'all' : householdIds,
    });

    const report = await runConsolidator(
      { supabase, queues, log, modelClient },
      { ...(householdIds.length > 0 ? { householdIds } : {}) },
    );

    log.info('consolidator run complete', {
      households_processed: report.householdsProcessed,
      entities_consolidated: report.entitiesConsolidated,
      fact_candidates_written: report.factCandidatesWritten,
      patterns_upserted: report.patternsUpserted,
      budget_exceeded_households: report.budgetExceededHouseholds,
    });
  },
  { shutdownTimeoutMs: 30_000 },
);

function parseHouseholdIds(raw: string | undefined): HouseholdId[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as HouseholdId[];
}

process.exit(exitCode);
