/**
 * Web-app environment loader.
 *
 * Two exports:
 *   - `publicEnv` — the `NEXT_PUBLIC_*` subset. Safe to import from both
 *     server and client code. Evaluated at module load.
 *   - `serverEnv` — a getter for the full schema, including the service-
 *     role key. Evaluated lazily the first time it's called. A separate
 *     getter (rather than a module-top-level `const`) keeps the server-
 *     only Zod schema out of the client bundle when a client component
 *     transitively imports this file for `publicEnv`; Next's tree-
 *     shaking drops the unused call path cleanly.
 *
 * ## Build-time opt-out
 *
 * Next's production build (`next build`) imports this module during its
 * static analysis pass, but CI shouldn't need real Supabase secrets to
 * produce a build artifact. When `NEXT_PHASE === 'phase-production-build'`
 * we relax both schemas so the build succeeds with empty values.
 * Runtime paths (`next start`, serverless invocations, `pnpm dev`) see
 * the non-optional shape and fail loudly on missing vars.
 */

import { baseServerEnvSchema, loadEnv } from '@homehub/shared';
import { z } from 'zod';

const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';

const requiredString = z.string().min(1);
const requiredUrl = z.string().url();

const buildSafeString = isBuildPhase ? z.string().default('') : requiredString;
const buildSafeUrl = isBuildPhase ? z.string().default('') : requiredUrl;

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: buildSafeUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: buildSafeString,
  NEXT_PUBLIC_APP_URL: buildSafeUrl,
});

const serverSchema = baseServerEnvSchema.extend({
  NEXT_PUBLIC_SUPABASE_URL: buildSafeUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: buildSafeString,
  SUPABASE_SERVICE_ROLE_KEY: buildSafeString,
  NEXT_PUBLIC_APP_URL: buildSafeUrl,
  /**
   * Nango host + secret key. Used by the `/api/integrations/connect`
   * route handler to mint a hosted-auth session for the member. Both
   * are optional so the app can boot without Nango configured (the
   * connect route itself returns 503 in that case).
   */
  NANGO_HOST: z.string().url().optional(),
  NANGO_SECRET_KEY: z.string().min(1).optional(),
  /**
   * Instacart Developer Platform app credentials. HomeHub uses these to
   * create Marketplace shopping-list URLs; shoppers log in and check out
   * on Instacart.
   */
  INSTACART_DEVELOPER_API_KEY: z.string().min(1).optional(),
  INSTACART_DEVELOPER_API_BASE_URL: z.string().url().default('https://connect.instacart.com'),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

/**
 * Public env — safe on both sides. Next's webpack plugin only inlines
 * `process.env.EXACT_NAME` member-expression references at build time;
 * it does NOT touch `process.env` itself when passed as an object. So
 * calling `loadEnv(schema, process.env)` from client code resolves to
 * `loadEnv(schema, {})` in the browser bundle and every `NEXT_PUBLIC_*`
 * key lands as `undefined`. We avoid that by building the source object
 * explicitly — each reference below IS a member-expression that webpack
 * will replace with the literal string from build-time env.
 */
const publicSource = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
} as unknown as NodeJS.ProcessEnv;

export const publicEnv: PublicEnv = loadEnv(publicSchema, publicSource);

let cachedServerEnv: ServerEnv | null = null;

/**
 * Lazy accessor for the full server-side env. Throws on missing vars at
 * call time (not import time) so that a client component transitively
 * pulling this module for `publicEnv` doesn't explode the page.
 *
 * Callers MUST only invoke this from server contexts (Server Components,
 * Route Handlers, Server Actions). Calling from a client component would
 * attempt to read `SUPABASE_SERVICE_ROLE_KEY` from `process.env`, which
 * is always `undefined` in the browser and will fail validation.
 */
export function serverEnv(): ServerEnv {
  cachedServerEnv ??= loadEnv(serverSchema);
  return cachedServerEnv;
}
