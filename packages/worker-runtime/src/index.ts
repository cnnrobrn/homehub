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
  DEFAULT_EMBEDDING_MODEL,
  type CreateModelClientOptions,
  type EmbedArgs,
  type EmbedResult,
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

export {
  createGoogleHttpClient,
  type CreateGoogleHttpClientDeps,
  type GoogleHttpClient,
  type ProviderHttpClient,
} from './google-oauth/client.js';

export {
  createTokenCrypto,
  createTokenCryptoFromEnv,
  isTokenCryptoConfigured,
  type EncryptedBlob,
  type TokenCrypto,
  type TokenCryptoConfig,
} from './google-oauth/crypto.js';

export {
  createGoogleProviderHttpClient,
  isGoogleOAuthConfigured,
  GoogleOAuthNotConfiguredError,
} from './google-oauth/factory.js';

export {
  GCAL_CHANNEL_KIND,
  GMAIL_HISTORY_ID_KIND,
  GMAIL_WATCH_KIND,
  runGcalPostConnect,
  runGmailPostConnect,
  runGoogleDisconnectCleanup,
  type GmailPostConnectOptions,
  type GoogleConnectionIdentity,
  type MinimalCalendarProvider,
  type MinimalEmailProvider,
  type PostConnectDeps,
  type PostConnectEnv,
} from './post-connect/google.js';

export { initTracing, type TracingHandle } from './otel/tracing.js';

export { initSentry, type InitSentryOptions, type SentryHandle } from './sentry/init.js';

export {
  recordWorkerHeartbeat,
  startHeartbeatLoop,
  type HeartbeatLoopHandle,
  type RecordHeartbeatArgs,
  type StartHeartbeatLoopOptions,
} from './heartbeat/heartbeat.js';

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
