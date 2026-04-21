/**
 * Invitation token generation + hashing.
 *
 * The raw token is handed to the owner once (via the server-action
 * return value) so they can share a signup URL. We never persist the
 * raw token — a DB dump should not leak live invitations. Instead we
 * persist `hmac_sha256(token, secret)` in `app.household_invitation.token_hash`,
 * indexed uniquely.
 *
 * Why HMAC rather than a plain SHA256:
 *   - A plain hash is deterministic and can be rainbow-table precomputed.
 *     With 32 bytes of random token that's uneconomic, but HMAC's cost
 *     over a plain hash is zero and makes the hash domain unforgeable
 *     without the secret.
 *   - Rotating `INVITATION_TOKEN_SECRET` invalidates outstanding invites,
 *     which is a property we want for incident response.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface TokenPair {
  /** Raw, URL-safe token — returned to the caller once and never persisted. */
  token: string;
  /** HMAC-SHA256 digest of `token` with the server secret, hex-encoded. */
  tokenHash: string;
}

/**
 * 32 bytes of entropy encoded as base64url. That's ~43 characters and
 * fits comfortably in a URL query parameter without padding. The
 * `base64url` encoding is RFC 4648 § 5 — no `/` or `+`, so no URL
 * escaping needed.
 */
export function generateInvitationToken(secret: string): TokenPair {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashInvitationToken(token, secret);
  return { token, tokenHash };
}

export function hashInvitationToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

/**
 * Constant-time comparison for two hex digests of equal length.
 * PostgREST filters on equality server-side, which is fine for
 * database-level comparison; this helper exists for in-process paths
 * (e.g. tests and any future code that compares two hashes). The
 * canonical lookup still goes through `.eq('token_hash', ...)` against
 * Postgres.
 */
export function tokensMatch(aHex: string, bHex: string): boolean {
  if (aHex.length !== bHex.length) return false;
  if (!/^[0-9a-f]+$/i.test(aHex) || !/^[0-9a-f]+$/i.test(bHex)) return false;
  try {
    return timingSafeEqual(Buffer.from(aHex, 'hex'), Buffer.from(bHex, 'hex'));
  } catch {
    return false;
  }
}
