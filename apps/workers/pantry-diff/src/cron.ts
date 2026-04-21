/**
 * `pantry-diff` cron entry.
 *
 * Railway schedules this hourly as a safety-net sweep. CLI flag
 * `--household=<uuid>` (repeatable) lets operators re-trigger a
 * household-scoped run.
 */

import { loadEnv } from '@homehub/shared';
import {
  createLogger,
  createServiceClient,
  initTracing,
  runWorker,
  workerRuntimeEnvSchema,
} from '@homehub/worker-runtime';

import { runPantryDiffWorker } from './handler.js';

const SERVICE_NAME = 'worker-pantry-diff-cron';

const env = loadEnv(workerRuntimeEnvSchema);
const log = createLogger(env, { service: SERVICE_NAME, component: 'cron' });

const argv = process.argv.slice(2);
const householdIds = argv.filter((a) => a.startsWith('--household=')).map((a) => a.split('=')[1]!);

const exitCode = await runWorker(
  async () => {
    initTracing(env);
    const supabase = createServiceClient(env);
    const summaries = await runPantryDiffWorker({
      supabase,
      log,
      ...(householdIds.length > 0 ? { householdIds } : {}),
    });
    log.info('pantry-diff cron run finished', {
      households: summaries.length,
      upserts: summaries.filter((s) => s.upsertedListId !== null).length,
    });
  },
  { shutdownTimeoutMs: 10_000 },
);

process.exit(exitCode);
