/**
 * `sync-financial` cron entry.
 *
 * Railway invokes this script hourly (cron schedule configured at the
 * service level; see the README). It iterates every active financial
 * provider connection and enqueues a `sync_delta:{provider}` job, then
 * exits. The main loop in `src/main.ts` picks the jobs up.
 *
 * Keeping the cron as a standalone script means:
 *   - The poll loop remains focused on one job at a time.
 *   - Operators can trigger a one-shot fan-out via `pnpm cron` or a
 *     `railway run` invocation without restarting the worker.
 *   - Tests cover the cron independently of the poll loop.
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

import { runFinancialCron } from './handler.js';

const SERVICE_NAME = 'worker-sync-financial-cron';

const env = loadEnv(workerRuntimeEnvSchema);
const log = createLogger(env, { service: SERVICE_NAME, component: 'cron' });

const exitCode = await runWorker(
  async () => {
    initTracing(env);
    const supabase = createServiceClient(env);
    const queues = createQueueClient(supabase);
    const { enqueued } = await runFinancialCron({ supabase, queues, log });
    log.info('financial cron run finished', { enqueued });
  },
  { shutdownTimeoutMs: 10_000 },
);

process.exit(exitCode);
