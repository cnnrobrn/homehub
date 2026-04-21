/**
 * `reflector` worker entrypoint.
 *
 * Runs as a Railway weekly cron (see `specs/05-agents/workers.md`).
 * Invocation shape:
 *
 *   pnpm --filter @homehub/worker-reflector start
 *
 * By default iterates every household in `app.household` for the most
 * recent Monday (UTC). Scope via the following env vars:
 *   - `HOMEHUB_HOUSEHOLD_IDS` — comma-separated household ids.
 *   - `HOMEHUB_WEEK_START`    — override `YYYY-MM-DD`; useful for
 *                               backfills. Defaults to last Monday UTC.
 *
 * Exits 0 on success, 1 on fatal error. A `/health` + `/ready` HTTP
 * server is also started so Railway's health checks don't flap during
 * the cron invocation.
 */

import { createServer } from 'node:http';

import { loadEnv, type HouseholdId } from '@homehub/shared';
import {
  createLogger,
  createModelClient,
  createServiceClient,
  initTracing,
  onShutdown,
  runWorker,
  workerRuntimeEnvSchema,
} from '@homehub/worker-runtime';

import { runReflector } from './handler.js';

const SERVICE_NAME = 'worker-reflector';

const env = loadEnv(workerRuntimeEnvSchema);
const log = createLogger(env, { service: SERVICE_NAME, component: 'main' });

const exitCode = await runWorker(
  async () => {
    initTracing(env);
    const supabase = createServiceClient(env);

    if (!env.OPENROUTER_API_KEY) {
      log.error('reflector requires OPENROUTER_API_KEY to be set');
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

    // Readiness probe: a head-count against app.household is cheap and
    // proves the service-role Supabase client can reach Postgres.
    try {
      const { error } = await supabase
        .schema('app')
        .from('household')
        .select('id', { count: 'exact', head: true });
      if (error) throw error;
      ready = true;
    } catch (err) {
      log.error('reflector readiness probe failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    const householdIds = parseHouseholdIds(process.env.HOMEHUB_HOUSEHOLD_IDS);
    const weekStartOverride = process.env.HOMEHUB_WEEK_START?.trim();
    log.info('reflector run starting', {
      household_scope: householdIds.length === 0 ? 'all' : householdIds,
      week_start: weekStartOverride ?? 'last_monday_utc',
    });

    const report = await runReflector(
      { supabase, log, modelClient },
      {
        ...(householdIds.length > 0 ? { householdIds } : {}),
        ...(weekStartOverride ? { weekStart: weekStartOverride } : {}),
      },
    );

    log.info('reflector run complete', {
      inserted: report.inserted,
      skipped: report.skipped,
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
