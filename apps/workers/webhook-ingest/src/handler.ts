/**
 * `webhook-ingest` HTTP handler dispatcher.
 *
 * This service is the single public HTTP ingress for every provider
 * webhook. Unlike the pgmq-consuming workers, its "handler" is a router
 * function — given a provider slug and a verified request, it enqueues a
 * fan-out job onto the correct `sync_*` queue.
 *
 * M0 stub. @integrations fills in real routing in M2 (gcal) onward.
 */

import { NotYetImplementedError } from '@homehub/worker-runtime';

export interface WebhookHandlerInput {
  readonly provider: string;
  readonly rawBody: Buffer;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

/**
 * Dispatch entrypoint. Real implementation validates HMAC, normalizes
 * payload, looks up the provider's household connection, and enqueues.
 */
export async function handler(_input: WebhookHandlerInput): Promise<void> {
  throw new NotYetImplementedError(
    'webhook-ingest handler not implemented; @integrations wires providers in M2+',
  );
}
