/**
 * The pgmq message envelope every HomeHub job carries.
 *
 * Defined in `specs/08-backend/queues.md`. All producers build messages
 * conforming to this schema; all consumers validate on claim. Malformed
 * messages are routed straight to the DLQ — schema drift must not
 * silently pollute downstream state.
 */

import { z } from 'zod';

/** Matches any UUID; DB enforces the stricter column type. */
const uuidSchema = z.uuid().describe('UUID for cross-service entity identification');

export const messageEnvelopeSchema = z.object({
  household_id: uuidSchema,
  kind: z.string().min(1),
  entity_id: uuidSchema,
  version: z.number().int().nonnegative(),
  enqueued_at: z.iso.datetime({ offset: true }),
});

export type MessageEnvelope = z.infer<typeof messageEnvelopeSchema>;
