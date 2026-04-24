/**
 * PKCE + state helpers for the Google OAuth dance.
 *
 * PKCE (RFC 7636) is required for public clients and strongly recommended
 * for confidential clients. Google supports it across all OAuth 2.0
 * clients. We use S256: the verifier is a random 32-byte url-safe base64
 * string, the challenge is `base64url(sha256(verifier))`.
 *
 * `state` is an unrelated 32-byte url-safe random string that bridges
 * /start and /callback through `sync.google_oauth_state`.
 */

import { createHash, randomBytes } from 'node:crypto';

/** Generate a 32-byte url-safe base64 random string. */
export function generateState(): string {
  return toBase64Url(randomBytes(32));
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}

/** Fresh PKCE pair. Caller persists `codeVerifier` and sends `codeChallenge`. */
export function generatePkcePair(): PkcePair {
  const codeVerifier = toBase64Url(randomBytes(32));
  const codeChallenge = toBase64Url(createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge, codeChallengeMethod: 'S256' };
}

function toBase64Url(buf: Buffer): string {
  return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
