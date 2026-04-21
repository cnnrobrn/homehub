/**
 * `reconciler` cron entry — hourly email-receipt ↔ provider-transaction
 * reconciliation pass.
 *
 * Railway invokes this script hourly (cron schedule configured at the
 * service level; see the README). Reconciles every household that has
 * at least one email-derived transaction, then exits.
 */

import { loadEnv } from '@homehub/shared';
import {
  createLogger,
  createServiceClient,
  initTracing,
  runWorker,
  workerRuntimeEnvSchema,
} from '@homehub/worker-runtime';

import { runFinancialReconciler } from './handler.js';

const SERVICE_NAME = 'worker-reconciler-cron';

const env = loadEnv(workerRuntimeEnvSchema);
const log = createLogger(env, { service: SERVICE_NAME, component: 'cron' });

const exitCode = await runWorker(
  async () => {
    initTracing(env);
    const supabase = createServiceClient(env);
    const summaries = await runFinancialReconciler({ supabase, log });
    log.info('reconciler cron run finished', {
      households: summaries.length,
      total_matches: summaries.reduce((acc, s) => acc + s.matchesLinked, 0),
      total_ambiguous: summaries.reduce((acc, s) => acc + s.ambiguousLeft, 0),
    });
  },
  { shutdownTimeoutMs: 10_000 },
);

process.exit(exitCode);
