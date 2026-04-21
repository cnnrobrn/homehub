/**
 * Server-side Supabase client for Next.js App Router.
 *
 * Wraps `@supabase/ssr`'s `createServerClient`, wiring it to Next's
 * async `cookies()` store so that auth tokens persist across requests
 * via the `sb-*` cookie. The client is typed against `@homehub/db`'s
 * `Database` shape so all queries return rows with the right types.
 *
 * Use this from Server Components, Route Handlers, and Server Actions.
 * A separate `./client.ts` factory exists for Client Components that
 * need realtime subscriptions.
 *
 * M1 will add `getHouseholdContext()` here once the `households` schema
 * + RLS are in place. For M0 the scope is intentionally minimal:
 *   - `createClient()` returns a typed `SupabaseClient<Database>`.
 *   - `getSession()` returns the current session or null. No redirects,
 *     no household lookup, no role resolution. Those are M1's problem.
 */

import { type Database } from '@homehub/db';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

import { publicEnv } from '@/lib/env';

export type ServerSupabaseClient = SupabaseClient<Database>;

/**
 * Create a Supabase client bound to the current request's cookies.
 * Must be called inside a Server Component / Route Handler / Server
 * Action (any context where `next/headers` is valid).
 *
 * The `set` / `remove` handlers swallow the error thrown when Next is
 * in a read-only cookie context (e.g. Server Components can call
 * `cookies()` but cannot mutate them outside Route Handlers / Actions).
 * That matches Supabase's official Next.js template; writing cookies
 * from a Server Component is the caller's bug, not ours.
 */
export async function createClient(): Promise<ServerSupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies; the middleware /
            // server-action path writes them instead. Safe to ignore.
          }
        },
      },
    },
  );
}

/**
 * Convenience reader for the current session. Returns `null` when the
 * user is signed out or the session cookie is invalid. Does NOT refresh
 * — use a Route Handler / Server Action for refresh flows in M1.
 */
export async function getSession() {
  const supabase = await createClient();
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) {
    // Treat an auth-layer error as "no session." Logging is the caller's
    // job once observability is wired; for M0 the shell doesn't yet know
    // about Sentry, and swallowing here avoids a crash on bad cookies.
    return null;
  }

  return session;
}
