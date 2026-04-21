/**
 * Session + user readers.
 *
 * Wrap Supabase Auth's `getSession` / `getUser` so callers get a
 * uniform `null | {...}` shape and errors are normalized into our
 * exception hierarchy.
 *
 * `getSession` is the cheap lookup; `getUser` is the trusted one —
 * Supabase recommends `getUser` for anything authorization-relevant
 * because it revalidates the JWT against the auth server. We use
 * `getUser` inside `getHouseholdContext` for that reason.
 */

import { type Session } from '@supabase/supabase-js';

import { type CookieAdapter, createServerClient } from '../clients/index.js';
import { type AuthServerEnv } from '../env.js';
import { InternalError } from '../errors/index.js';

export interface SessionUser {
  id: string;
  email: string | null;
  created_at: string;
}

export async function getSession(
  env: Pick<AuthServerEnv, 'SUPABASE_URL' | 'SUPABASE_ANON_KEY'>,
  cookies: CookieAdapter,
): Promise<Session | null> {
  const client = createServerClient(env, cookies);
  const { data, error } = await client.auth.getSession();
  if (error) {
    // A missing / malformed cookie is "no session", not a hard error.
    return null;
  }
  return data.session ?? null;
}

export async function getUser(
  env: Pick<AuthServerEnv, 'SUPABASE_URL' | 'SUPABASE_ANON_KEY'>,
  cookies: CookieAdapter,
): Promise<SessionUser | null> {
  const client = createServerClient(env, cookies);
  const { data, error } = await client.auth.getUser();
  if (error) {
    // `auth.getUser()` returns `AuthSessionMissingError` when there's no
    // session — treat that as null. Anything else is unexpected.
    const msg = (error as { message?: string }).message ?? '';
    if (/session/i.test(msg) || /jwt/i.test(msg)) {
      return null;
    }
    throw new InternalError(`auth.getUser failed: ${msg}`, { cause: error });
  }
  const u = data.user;
  if (!u) return null;
  return {
    id: u.id,
    email: u.email ?? null,
    created_at: u.created_at,
  };
}
