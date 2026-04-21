/**
 * Supabase client factories for `@homehub/auth-server`.
 *
 * Two flavors:
 *
 *   - **Member-scoped** (`createServerClient`): wraps `@supabase/ssr`'s
 *     `createServerClient` and carries the user's session cookie. All
 *     reads and writes run under the `authenticated` JWT role, so RLS
 *     policies enforce household isolation automatically.
 *
 *   - **Service-role** (`createServiceClient`): bypasses RLS. Reserved
 *     for operations that legitimately cannot be scoped to a member,
 *     specifically:
 *       1. Invitation lookup by `token_hash`. The caller presents a raw
 *          token before signing in or after signing up into a brand-new
 *          auth.users row with no membership yet — RLS would deny the
 *          read.
 *       2. `audit.event` writes. The authenticated role has no policy on
 *          that schema, by design (audit is append-only and
 *          service-role-gated).
 *       3. Flows that must mutate membership tables across a session
 *          boundary (e.g. the bootstrap insert of `app.member` during
 *          household creation — Supabase cookies may not be writable in
 *          Server Components, and the RLS bootstrap policy assumes the
 *          same caller; using service-role keeps flows atomic).
 *
 * The service-role client is created lazily so callers without a service
 * key can still use the member-scoped path.
 */

import { type Database } from '@homehub/db';
import { createServerClient as createSsrServerClient } from '@supabase/ssr';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';

import { type AuthServerEnv } from '../env.js';

export type MemberSupabaseClient = SupabaseClient<Database>;
export type ServiceSupabaseClient = SupabaseClient<Database>;

/**
 * Cookie store abstraction. Callers adapt whichever framework primitive
 * they have (Next.js `cookies()`, Remix loader args, etc.) to this shape.
 */
export interface CookieAdapter {
  getAll(): { name: string; value: string }[];
  /**
   * Optional. Server Components cannot write cookies in Next.js; Route
   * Handlers and Server Actions can. Implementations that cannot write
   * should no-op (matching Supabase's template behavior).
   */
  setAll?(cookies: { name: string; value: string; options: Record<string, unknown> }[]): void;
}

export function createServerClient(
  env: Pick<AuthServerEnv, 'SUPABASE_URL' | 'SUPABASE_ANON_KEY'>,
  cookies: CookieAdapter,
): MemberSupabaseClient {
  return createSsrServerClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookies.getAll();
      },
      setAll(toSet) {
        try {
          cookies.setAll?.(toSet);
        } catch {
          // Server Component context: writes not allowed. The middleware
          // / server-action path refreshes cookies. Safe to swallow.
        }
      },
    },
  });
}

export function createServiceClient(
  env: Pick<AuthServerEnv, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>,
): ServiceSupabaseClient {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        'x-homehub-client': 'auth-server',
      },
    },
  });
}
