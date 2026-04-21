/**
 * `@homehub/worker-runtime` — shared base for every HomeHub worker.
 *
 * Every background worker under `apps/workers/*` imports from this
 * barrel. Keep the public surface tight; new exports are an API
 * commitment across the whole worker fleet.
 */

export {
  withBudgetGuard,
  type BudgetCheckResult,
  type BudgetTier,
  type WithBudgetGuardArgs,
} from './budget/guard.js';

export { workerRuntimeEnvSchema, type WorkerRuntimeEnv } from './env.js';

export {
  ModelCallError,
  NangoError,
  NotYetImplementedError,
  QueueError,
  StructuredOutputError,
} from './errors.js';

export { createLogger, type LogContext, type Logger, type LoggerOptions } from './log/logger.js';

export {
  createModelClient,
  type CreateModelClientOptions,
  type GenerateArgs,
  type GenerateResult,
  type ModelClient,
} from './model/client.js';

export { resolveDefaults, type ModelParams } from './model/defaults.js';

export {
  createNangoClient,
  type ConnectSessionEndUser,
  type CreateConnectSessionOptions,
  type CreateConnectSessionResult,
  type NangoClient,
  type NangoConnection,
  type ProxyOptions,
} from './nango/client.js';

export { initTracing, type TracingHandle } from './otel/tracing.js';

export { onShutdown, runWorker, type RunWorkerOptions } from './lifecycle/run.js';

export {
  createQueueClient,
  type ClaimedMessage,
  type ClaimOptions,
  type NackOptions,
  type QueueClient,
  type SendOptions,
} from './queue/client.js';

export { messageEnvelopeSchema, type MessageEnvelope } from './queue/envelope.js';

export { queueNames, staticQueueNames } from './queue/registry.js';

export {
  createAnonClient,
  createServiceClient,
  type AnonSupabaseClient,
  type ServiceSupabaseClient,
} from './supabase/client.js';
