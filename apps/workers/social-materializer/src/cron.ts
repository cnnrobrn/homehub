/**
 * `social-materializer` cron entry.
 *
 * Railway invokes this script daily at 05:15 UTC (see the service
 * README). One-shot: materializes birthday + anniversary facts for
 * every household, then exits.
 *
 * CLI: `--household=<uuid>` (repeatable) for operator-scoped reruns.
 */

import { loadEnv } from '@homehub/shared';
import {
  createLogger,
  createServiceClient,
  initTracing,
  runWorker,
  workerRuntimeEnvSchema,
} from '@homehub/worker-runtime';

import { runSocialMaterializer } from './handler.js';

const SERVICE_NAME = 'worker-social-materializer-cron';

const env = loadEnv(workerRuntimeEnvSchema);
const log = createLogger(env, { service: SERVICE_NAME, component: 'cron' });

const argv = process.argv.slice(2);
const householdIds = argv.filter((a) => a.startsWith('--household=')).map((a) => a.split('=')[1]!);

const exitCode = await runWorker(
  async () => {
    initTracing(env);
    const supabase = createServiceClient(env);
    const results = await runSocialMaterializer({
      supabase,
      log,
      ...(householdIds.length > 0 ? { householdIds } : {}),
    });
    log.info('social-materializer cron run finished', {
      households: results.length,
      inserted: results.reduce((acc, r) => acc + r.eventsInserted, 0),
      reused: results.reduce((acc, r) => acc + r.eventsReused, 0),
      stale: results.reduce((acc, r) => acc + r.staleMarked, 0),
    });
  },
  { shutdownTimeoutMs: 10_000 },
);

process.exit(exitCode);
