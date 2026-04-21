/**
 * Supabase clients for the worker runtime.
 *
 * Two factories:
 *   - `createServiceClient` — full service-role access. Used by workers
 *     to read/write application data and drive pgmq. Bypasses RLS by
 *     design; the worker is the enforcement point.
 *   - `createAnonClient` — anon-key client for the rare workers that
 *     need to read truly-public data (not used day-to-day). Errors if
 *     the anon key wasn't provided in env.
 *
 * Both are typed against `@homehub/db`'s `Database` so row returns are
 * correctly shaped as the schema evolves.
 */

import { type Database } from '@homehub/db';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { type WorkerRuntimeEnv } from '../env.js';

export type ServiceSupabaseClient = SupabaseClient<Database>;
export type AnonSupabaseClient = SupabaseClient<Database>;

/**
 * Service-role Supabase client. Disables session persistence (workers
 * are stateless) and token auto-refresh (the service-role JWT does not
 * rotate mid-process).
 */
export function createServiceClient(env: WorkerRuntimeEnv): ServiceSupabaseClient {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        'x-homehub-client': 'worker-runtime',
      },
    },
  });
}

/**
 * Anon-key Supabase client. Throws if `SUPABASE_ANON_KEY` is unset,
 * because callers asking for an anon client with no anon key are almost
 * always misconfigured.
 */
export function createAnonClient(env: WorkerRuntimeEnv): AnonSupabaseClient {
  if (!env.SUPABASE_ANON_KEY) {
    throw new Error('createAnonClient: SUPABASE_ANON_KEY is not set');
  }
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        'x-homehub-client': 'worker-runtime-anon',
      },
    },
  });
}
