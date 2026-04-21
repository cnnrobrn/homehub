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
 *    the Nango webhook (Nango's webhook secret signs the POST body).
 *
 *  - **Google Calendar push notifications** — Google does NOT sign the
 *    payload. Instead, the `X-Goog-Channel-Token` header (or, in our
 *    case, the `X-Goog-Channel-ID` lookup against stored channels)
 *    serves as the shared secret. See `verifyGoogleChannel` below.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

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
  /** Optional encoding hint. Defaults to hex; Slack uses hex, Nango base64. */
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
  const actual = input.signature.trim();
  if (expected.length !== actual.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
  } catch {
    return false;
  }
}
