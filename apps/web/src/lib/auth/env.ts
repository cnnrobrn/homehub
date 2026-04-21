/**
 * Assemble the `@homehub/auth-server` env from the web app's already-
 * validated env layer.
 *
 * The web app's `@/lib/env` loads `SUPABASE_SERVICE_ROLE_KEY` lazily so
 * a client bundle that transitively imports the module doesn't explode.
 * We do the same here — `authEnv()` reads the server env at call time,
 * which means Server Actions get the full set and Server Components that
 * only need `publicEnv` never call us.
 *
 * The `INVITATION_TOKEN_SECRET` is read directly from `process.env`
 * because it is server-only and not part of the build-phase opt-out —
 * a missing secret must fail loudly.
 */

import { authServerEnvSchema, type AuthServerEnv } from '@homehub/auth-server';

import { serverEnv } from '@/lib/env';

let cached: AuthServerEnv | null = null;

export function authEnv(): AuthServerEnv {
  if (cached) return cached;
  const se = serverEnv();
  cached = authServerEnvSchema.parse({
    NODE_ENV: se.NODE_ENV,
    LOG_LEVEL: se.LOG_LEVEL,
    SUPABASE_URL: se.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: se.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: se.SUPABASE_SERVICE_ROLE_KEY,
    INVITATION_TOKEN_SECRET: process.env.INVITATION_TOKEN_SECRET,
    INVITATION_TTL_DAYS: process.env.INVITATION_TTL_DAYS,
  });
  return cached;
}
