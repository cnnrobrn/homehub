/**
 * `summaries` cron entry.
 *
 * Railway cron invokes this script with an env flag indicating which
 * period to run:
 *
 *   - weekly:  `0 4 * * 1`  (Monday 04:00 UTC)  → HOMEHUB_SUMMARIES_PERIOD=weekly
 *   - monthly: `0 5 1 * *`  (1st of month 05:00 UTC) → HOMEHUB_SUMMARIES_PERIOD=monthly
 *
 * The CLI also accepts `--period=<weekly|monthly|daily>` or
 * `--household=<uuid>` (repeatable) so operators can re-trigger a
 * household-scoped rerun without waiting for the cron.
 */

import { loadEnv } from '@homehub/shared';
import {
  createLogger,
  createServiceClient,
  initTracing,
  runWorker,
  workerRuntimeEnvSchema,
} from '@homehub/worker-runtime';

import { runSummariesWorker } from './handler.js';

import type { SummaryPeriod } from '@homehub/summaries';

const SERVICE_NAME = 'worker-summaries-cron';

const env = loadEnv(workerRuntimeEnvSchema);
const log = createLogger(env, { service: SERVICE_NAME, component: 'cron' });

const argv = process.argv.slice(2);

function parsePeriod(): SummaryPeriod[] {
  const fromArg = argv.find((a) => a.startsWith('--period='))?.split('=')[1];
  const fromEnv = process.env.HOMEHUB_SUMMARIES_PERIOD;
  const raw = fromArg ?? fromEnv ?? 'weekly';
  const valid: SummaryPeriod[] = ['daily', 'weekly', 'monthly'];
  if (!valid.includes(raw as SummaryPeriod)) {
    log.warn('unknown period; falling back to weekly', { raw });
    return ['weekly'];
  }
  return [raw as SummaryPeriod];
}

function parseHouseholds(): string[] | undefined {
  const ids = argv.filter((a) => a.startsWith('--household=')).map((a) => a.split('=')[1]!);
  return ids.length > 0 ? ids : undefined;
}

const exitCode = await runWorker(
  async () => {
    initTracing(env);
    const supabase = createServiceClient(env);
    const periods = parsePeriod();
    const householdIds = parseHouseholds();
    const results = await runSummariesWorker({
      supabase,
      log,
      periods,
      ...(householdIds ? { householdIds } : {}),
    });
    log.info('summaries cron run finished', {
      periods,
      inserted: results.filter((r) => !r.skipped).length,
      skipped: results.filter((r) => r.skipped).length,
    });
  },
  { shutdownTimeoutMs: 10_000 },
);

process.exit(exitCode);
