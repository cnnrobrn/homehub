/**
 * Adapter that shapes the web app's `serverEnv()` into the
 * `WorkerRuntimeEnv` shape that `@homehub/worker-runtime` expects.
 *
 * `createServiceClient` and `createModelClient` both live in the
 * worker-runtime package (they're shared across workers and the
 * memory retrieval code). The web app doesn't need the whole
 * worker env, just the Supabase + OpenRouter slice — we fill
 * defaults for the fields the worker-runtime schema requires but
 * the web app has no use for.
 *
 * Server-only: the returned value includes the service-role key.
 * Never import this from a client component.
 */
import { type WorkerRuntimeEnv } from '@homehub/worker-runtime';

import { serverEnv } from '@/lib/env';

export function memoryRuntimeEnv(): WorkerRuntimeEnv {
  const env = serverEnv();
  return {
    NODE_ENV: (env.NODE_ENV ?? 'development') as WorkerRuntimeEnv['NODE_ENV'],
    LOG_LEVEL: (env.LOG_LEVEL ?? 'info') as WorkerRuntimeEnv['LOG_LEVEL'],
    OTEL_SERVICE_NAME: env.OTEL_SERVICE_NAME,
    OTEL_EXPORTER_OTLP_ENDPOINT: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_ANON_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NANGO_HOST: env.NANGO_HOST,
    NANGO_SECRET_KEY: env.NANGO_SECRET_KEY,
    ...(env.INSTACART_DEVELOPER_API_KEY
      ? { INSTACART_DEVELOPER_API_KEY: env.INSTACART_DEVELOPER_API_KEY }
      : {}),
    INSTACART_DEVELOPER_API_BASE_URL: env.INSTACART_DEVELOPER_API_BASE_URL,
    // OpenRouter knobs — optional. When unset, semantic seeding is
    // skipped and `query_memory` falls back to structural retrieval.
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    OPENROUTER_HTTP_REFERER: process.env.OPENROUTER_HTTP_REFERER ?? 'https://app.homehub.ing',
    OPENROUTER_APP_TITLE: process.env.OPENROUTER_APP_TITLE ?? 'HomeHub',
  };
}
