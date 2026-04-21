/**
 * Executor for the `propose_book_reservation` action kind.
 *
 * There is no generic reservation API in v1 (OpenTable / Resy / venue
 * direct all behave differently, and operator-level credentials are
 * gated). The v1 path: draft a Gmail message to the venue via the
 * member's google-mail connection. Member reviews, sends from Gmail.
 *
 * See `specs/13-conversation/tools.md` § propose_book_reservation.
 */

import { type EmailProvider } from '@homehub/providers-email';
import { z } from 'zod';

import { throwAsExecutorError } from '../classifyProviderError.js';
import { coerceRecord, PermanentExecutorError, toPayloadInvalidError } from '../errors.js';
import { resolveConnection } from '../resolveConnection.js';
import { type ActionExecutor, type ExecutorDeps } from '../types.js';

export const proposeBookReservationPayloadSchema = z.object({
  recipient_email: z.string().email(),
  venue_name: z.string().min(1),
  party_size: z.number().int().positive(),
  proposed_times: z.array(z.string()).min(1, 'at least one proposed time required'),
  notes: z.string().optional(),
  subject: z.string().optional(),
});

export type ProposeBookReservationPayload = z.infer<typeof proposeBookReservationPayloadSchema>;

export interface CreateProposeBookReservationExecutorArgs {
  email: EmailProvider;
  supabase: ExecutorDeps['supabase'];
}

function renderBody(payload: ProposeBookReservationPayload): string {
  const times = payload.proposed_times.map((t) => `- ${t}`).join('\n');
  const notes = payload.notes ? `\n\nNotes: ${payload.notes}` : '';
  return [
    `Hi ${payload.venue_name},`,
    '',
    `I would like to request a reservation for ${payload.party_size} ` +
      `${payload.party_size === 1 ? 'guest' : 'guests'}.`,
    '',
    'Proposed times:',
    times,
    '',
    'Please let me know which works.' + notes,
    '',
    'Thank you.',
  ].join('\n');
}

export function createProposeBookReservationExecutor(
  deps: CreateProposeBookReservationExecutorArgs,
): ActionExecutor {
  return async ({ action, suggestion, log }) => {
    const payloadCandidate = {
      ...coerceRecord(suggestion.preview),
      ...coerceRecord(action.payload),
    };
    let payload: ProposeBookReservationPayload;
    try {
      payload = proposeBookReservationPayloadSchema.parse(payloadCandidate);
    } catch (err) {
      throw toPayloadInvalidError(err);
    }

    const conn = await resolveConnection(deps.supabase, {
      householdId: action.household_id,
      provider: 'gmail',
    });
    if (!conn) {
      throw new PermanentExecutorError(
        'no_gmail_connection',
        `household ${action.household_id} has no active google-mail connection`,
      );
    }

    const subject =
      payload.subject ?? `Reservation request — ${payload.venue_name} for ${payload.party_size}`;
    const body = renderBody(payload);

    log.info('drafting reservation email via gmail', {
      venue: payload.venue_name,
      party_size: payload.party_size,
    });

    try {
      const draft = await deps.email.createDraft({
        connectionId: conn.connectionId,
        to: [payload.recipient_email],
        subject,
        bodyMarkdown: body,
      });
      return {
        result: {
          draft_id: draft.draftId,
          thread_id: draft.threadId,
          message_id: draft.messageId,
          connection_id: conn.connectionRowId,
        },
      };
    } catch (err) {
      if (err instanceof PermanentExecutorError) throw err;
      throwAsExecutorError(err, 'gmail_draft_write_failed');
    }
  };
}
