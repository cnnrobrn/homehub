/**
 * Mint short-lived, household-scoped Supabase JWTs.
 *
 * The router hands each sandbox a JWT signed with the same HS256 secret
 * Supabase uses for its own auth tokens. When the sandbox hits
 * PostgREST with `Authorization: Bearer <this>`, Supabase validates the
 * signature and exposes the claims to RLS via `auth.uid()` +
 * `auth.jwt()`.
 *
 * Claims:
 *   sub            — the chatting member's auth.users.id. Existing RLS
 *                    helpers (`app.is_member`, `app.member_id`, etc.)
 *                    read this via `auth.uid()`; membership in the
 *                    target household is enforced there.
 *   role           — "authenticated" (matches the PostgREST role every
 *                    RLS policy is already written against).
 *   household_id   — custom claim naming the specific household this
 *                    turn is scoped to. A follow-up migration will make
 *                    RLS prefer this claim over the user-lookup so a
 *                    user with multiple households can't cross-read
 *                    from a buggy skill. Until then, treat this as an
 *                    audit/debug claim.
 *   hermes         — marker that this token was minted for a sandbox;
 *                    useful for later auditing.
 *   iat / exp      — short TTL (default 600s) so a leaked token from
 *                    a sandbox crash is self-limiting.
 *   aud            — "authenticated" per Supabase convention.
 *
 * HS256 is implemented via the built-in `crypto` module — no extra
 * dependency. Supabase accepts HS256 by default; RS256 requires a
 * per-project JWKS config we don't need yet.
 */

import { createHmac } from 'node:crypto';

export interface MintHouseholdJwtInput {
  userId: string;
  householdId: string;
  memberId: string;
  jwtSecret: string;
  ttlSeconds?: number;
}

const DEFAULT_TTL_SECONDS = 600;

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function mintHouseholdJwt(input: MintHouseholdJwtInput): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    aud: 'authenticated',
    role: 'authenticated',
    sub: input.userId,
    iat: nowSec,
    exp: nowSec + ttl,
    household_id: input.householdId,
    hermes_member_id: input.memberId,
    hermes: true,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = createHmac('sha256', input.jwtSecret).update(signingInput).digest();
  const encodedSignature = base64url(signature);

  return `${signingInput}.${encodedSignature}`;
}
