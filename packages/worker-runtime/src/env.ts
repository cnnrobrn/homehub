/**
 * The worker-runtime env schema. Every worker service loads this (or an
 * extended form) at startup via `loadEnv(workerRuntimeEnvSchema)`.
 *
 * Notable:
 *  - `SUPABASE_SERVICE_ROLE_KEY` is the service-role JWT. Never ships to
 *    the browser. Per `specs/09-security/auth.md`, workers are the only
 *    holders of this key.
 *  - `NANGO_SECRET_KEY` + `NANGO_HOST` are required even on workers that
 *    don't currently call Nango — the runtime composes a client lazily.
 *  - `OPENROUTER_API_KEY` is required for any worker that will call
 *    `generate()`. Make it optional here and let `createModelClient`
 *    throw if it's missing, so workers that never call a model don't
 *    need the key.
 *  - All OTel knobs are optional. When absent, tracing is a no-op.
 */

import { baseServerEnvSchema } from '@homehub/shared';
import { z } from 'zod';

export const workerRuntimeEnvSchema = baseServerEnvSchema.extend({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),

  NANGO_HOST: z.string().url().optional(),
  NANGO_SECRET_KEY: z.string().min(1).optional(),

  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  OPENROUTER_HTTP_REFERER: z.string().url().default('https://app.homehub.ing'),
  OPENROUTER_APP_TITLE: z.string().min(1).default('HomeHub'),

  /**
   * Optional Sentry DSN for error reporting. When unset, `initSentry()`
   * no-ops so dev environments aren't forced to set up Sentry.
   */
  SENTRY_DSN: z.string().url().optional(),
});

export type WorkerRuntimeEnv = z.infer<typeof workerRuntimeEnvSchema>;
