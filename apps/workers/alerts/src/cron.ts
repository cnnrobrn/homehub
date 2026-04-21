/**
 * `alerts` cron entry.
 *
 * Railway invokes this script daily at 06:00 UTC (see the service
 * README). Runs the subscription-detector pre-step + all seven
 * financial detectors for every household, then exits.
 *
 * CLI: `--household=<uuid>` (repeatable) for operator reruns.
 */

import { loadEnv } from '@homehub/shared';
import {
  createLogger,
  createQueueClient,
  createServiceClient,
  initTracing,
  runWorker,
  workerRuntimeEnvSchema,
} from '@homehub/worker-runtime';

import { runAlertsWorker } from './handler.js';

const SERVICE_NAME = 'worker-alerts-cron';

const env = loadEnv(workerRuntimeEnvSchema);
const log = createLogger(env, { service: SERVICE_NAME, component: 'cron' });

const argv = process.argv.slice(2);
const householdIds = argv.filter((a) => a.startsWith('--household=')).map((a) => a.split('=')[1]!);

const exitCode = await runWorker(
  async () => {
    initTracing(env);
    const supabase = createServiceClient(env);
    const queues = createQueueClient(supabase);
    const summaries = await runAlertsWorker({
      supabase,
      queues,
      log,
      ...(householdIds.length > 0 ? { householdIds } : {}),
    });
    log.info('alerts cron run finished', {
      households: summaries.length,
      inserted: summaries.reduce((acc, s) => acc + s.inserted, 0),
      suppressed: summaries.reduce((acc, s) => acc + s.dedupedSuppressed, 0),
    });
  },
  { shutdownTimeoutMs: 10_000 },
);

process.exit(exitCode);
