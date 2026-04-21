/**
 * Environment schema for `@homehub/auth-server`.
 *
 * This package runs server-side only (Next.js Server Components / Server
 * Actions, or any Node process). It needs:
 *
 *   - `SUPABASE_URL` / `SUPABASE_ANON_KEY` — used by the member-scoped
 *     client that `createServerClient` wraps. RLS enforces household
 *     isolation; the anon key is the browser-safe key.
 *   - `SUPABASE_SERVICE_ROLE_KEY` — used only for the narrow set of
 *     operations that legitimately bypass RLS: invitation lookup by
 *     token_hash (a pre-auth caller has no session yet) and audit.event
 *     writes (an append-only log; authenticated JWT role has no policy).
 *   - `INVITATION_TOKEN_SECRET` — HMAC key that turns an opaque invitation
 *     token into a stable hash we can index on. Rotating this invalidates
 *     outstanding invites, which is fine: invites are re-issuable.
 *
 * Site URL + the web app's env layer feed `NEXT_PUBLIC_SUPABASE_URL`; this
 * package accepts both names via a union to keep the Next.js ergonomics
 * clean without forcing callers to map variables.
 */

import { baseServerEnvSchema } from '@homehub/shared';
import { z } from 'zod';

export const authServerEnvSchema = baseServerEnvSchema.extend({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  /**
   * HMAC-SHA256 key. Must be at least 32 bytes of entropy. We accept
   * any string of length >= 32 for flexibility (hex / base64url / raw).
   */
  INVITATION_TOKEN_SECRET: z.string().min(32),
  /**
   * Invitations expire after this many days. Defaults to 7 (spec:
   * `households.md` § Invitations).
   */
  INVITATION_TTL_DAYS: z.coerce.number().int().positive().default(7),
});

export type AuthServerEnv = z.infer<typeof authServerEnvSchema>;

/**
 * Tiny helper the server actions call with the web app's already-validated
 * env object. We avoid calling `loadEnv(authServerEnvSchema)` internally
 * because the web app's env loader has its own build-phase escape hatch;
 * letting the caller inject gives the package a single point of control.
 */
export function resolveAuthServerEnv(source: NodeJS.ProcessEnv = process.env): AuthServerEnv {
  return authServerEnvSchema.parse({
    ...source,
    // Allow the web app's NEXT_PUBLIC_ vars to satisfy the schema without
    // forcing callers to remap. If both are present the explicit
    // SUPABASE_URL / SUPABASE_ANON_KEY wins.
    SUPABASE_URL: source.SUPABASE_URL ?? source.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: source.SUPABASE_ANON_KEY ?? source.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}
