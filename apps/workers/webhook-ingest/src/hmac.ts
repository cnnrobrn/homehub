/**
 * HMAC verification scaffolding for inbound provider webhooks.
 *
 * Every provider we integrate with (Google, Gmail push, Monarch, Plaid,
 * Instacart, etc.) signs its webhooks differently. This stub exists so
 * @integrations has a single place to plug in provider-specific logic
 * in M2+ without touching the routing layer.
 */

import { NotYetImplementedError } from '@homehub/worker-runtime';

export interface HmacVerifyInput {
  /** Provider slug (e.g. "gcal", "plaid"). Maps to the signing secret. */
  readonly provider: string;
  /** Raw request body as received over the wire. */
  readonly rawBody: Buffer;
  /** Request headers, lower-cased keys. */
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  /** Signing secret loaded from env/Vault for this provider. */
  readonly secret: string;
}

/**
 * Verifies an inbound webhook signature. M0 stub — throws on every call
 * so misuse is loud. @integrations implements provider-specific handlers
 * when wiring each sync worker.
 */
export function verifyHmac(_input: HmacVerifyInput): void {
  throw new NotYetImplementedError(
    'verifyHmac is a scaffold stub; @integrations wires provider-specific verification in M2+',
  );
}
