/**
 * Provider webhook verification helpers.
 *
 * Providers authenticate their webhooks in several incompatible ways. We
 * keep verification in this module so the router itself is thin.
 *
 * Verification styles supported today:
 *
 *  - **HMAC (generic)** — Slack, Plaid, Monarch, Instacart all sign
 *    payloads with a shared secret. Implementation below computes
 *    `hmac-sha256(secret, rawBody)` and timing-safe compares. Used by
 *    Nango's newer `X-Nango-Hmac-Sha256` header.
 *
 *  - **Nango legacy SHA-256** — Nango 0.70's SDK verifies
 *    `X-Nango-Signature` as `sha256(secret + JSON.stringify(payload))`.
 *    Keep this until the self-hosted Nango image is upgraded.
 *
 *  - **Google Calendar push notifications** — Google does NOT sign the
 *    payload. Instead, the `X-Goog-Channel-Token` header (or, in our
 *    case, the `X-Goog-Channel-ID` lookup against stored channels)
 *    serves as the shared secret. See `verifyGoogleChannel` below.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface HmacVerifyInput {
  /** Raw request body bytes as received over the wire. */
  readonly rawBody: Buffer;
  /**
   * The signature the provider sent (hex or base64). Caller strips any
   * `sha256=` prefix the provider prepends.
   */
  readonly signature: string;
  /** Signing secret loaded from env for this provider. */
  readonly secret: string;
  /** Optional encoding hint. Defaults to hex. */
  readonly encoding?: 'hex' | 'base64';
}

/**
 * Timing-safe HMAC-SHA256 verifier. Returns `true` on match, `false` on
 * mismatch. Never throws on a mismatched signature — the caller maps it
 * to a 401 / 403 response.
 */
export function verifyHmac(input: HmacVerifyInput): boolean {
  const encoding = input.encoding ?? 'hex';
  const expected = createHmac('sha256', input.secret).update(input.rawBody).digest(encoding);
  return timingSafeCompare(expected, input.signature);
}

export interface NangoLegacyVerifyInput {
  /** Parsed JSON request body. */
  readonly payload: unknown;
  /** Value from the legacy `X-Nango-Signature` header. */
  readonly signature: string;
  /** Nango environment secret key. */
  readonly secret: string;
}

export function verifyNangoLegacySignature(input: NangoLegacyVerifyInput): boolean {
  const expected = createHash('sha256')
    .update(`${input.secret}${JSON.stringify(input.payload)}`)
    .digest('hex');
  return timingSafeCompare(expected, input.signature);
}

function timingSafeCompare(expected: string, signature: string): boolean {
  const actual = signature.trim();
  if (expected.length !== actual.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
  } catch {
    return false;
  }
}
