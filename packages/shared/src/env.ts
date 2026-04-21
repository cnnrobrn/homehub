/**
 * Zod-validated environment loader.
 *
 * Every package that needs environment variables defines its own Zod
 * schema (extending `baseServerEnvSchema`) and calls `loadEnv` exactly
 * once at startup. Failures are fatal and loud — we never try to run
 * with a partially-configured environment.
 *
 * `loadEnv` does NOT read from `.env` files. Environment assembly is the
 * caller's job (dotenv, Railway, Vercel), and this function just
 * validates what's already in `process.env`. That keeps the contract
 * dead-simple and avoids "which .env file won" bugs.
 */

import { z } from 'zod';

export const logLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
export type LogLevel = z.infer<typeof logLevelSchema>;

/**
 * Base schema every server-side package extends. Browser code uses a
 * separate schema (it must never see service-role keys). If a new field
 * lands here, every worker inherits it automatically — think twice
 * before adding.
 */
export const baseServerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  LOG_LEVEL: logLevelSchema.default('info'),
  OTEL_SERVICE_NAME: z.string().min(1).optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
});

export type BaseServerEnv = z.infer<typeof baseServerEnvSchema>;

/**
 * Validates `source` (defaults to `process.env`) against `schema` and
 * returns the typed result. On failure, throws a formatted error listing
 * every missing or invalid key so deployment logs show the full picture
 * instead of one key at a time.
 */
export function loadEnv<T extends z.ZodTypeAny>(
  schema: T,
  source: NodeJS.ProcessEnv = process.env,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => {
        const path = i.path.join('.') || '<root>';
        return `  - ${path}: ${i.message}`;
      })
      .join('\n');
    throw new Error(`Environment validation failed:\n${issues}`);
  }
  return result.data;
}
