/**
 * Minimal id_token payload extractor.
 *
 * We only need `sub` and `email` from the id_token returned by Google's
 * `/token` endpoint during the OAuth code exchange. We do NOT verify the
 * signature because:
 *   - The id_token came back over TLS on a same-request exchange where we
 *     authenticated with our client secret. Google cannot return a token
 *     we didn't ask for.
 *   - Full JWKS verification adds a network dependency (fetch JWKS, rotate
 *     cache, RS256 verify) without meaningfully raising the security bar
 *     in this flow. It WOULD be necessary if we accepted id_tokens from
 *     an untrusted origin — that's not what we're doing.
 *
 * If a future flow relays an id_token sourced outside our own code
 * exchange, swap this for a proper verifier. For now: parse + trust.
 */

export interface GoogleIdTokenPayload {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  aud?: string;
  iss?: string;
  exp?: number;
  [key: string]: unknown;
}

export function decodeIdTokenPayload(idToken: string): GoogleIdTokenPayload {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('decodeIdTokenPayload: id_token is not a well-formed JWT');
  }
  const payloadSegment = parts[1] ?? '';
  const b64 = payloadSegment.replaceAll('-', '+').replaceAll('_', '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const json = Buffer.from(padded, 'base64').toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `decodeIdTokenPayload: payload is not JSON (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('decodeIdTokenPayload: payload is not an object');
  }
  const payload = parsed as Record<string, unknown>;
  const sub = payload.sub;
  const email = payload.email;
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new Error('decodeIdTokenPayload: missing sub claim');
  }
  if (typeof email !== 'string' || email.length === 0) {
    throw new Error('decodeIdTokenPayload: missing email claim');
  }
  return { ...payload, sub, email } as GoogleIdTokenPayload;
}
