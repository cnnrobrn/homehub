/**
 * Executor for the `outing_idea` action kind.
 *
 * Approved outings become Google Calendar events. We delegate to the
 * shared `createAddToCalendarExecutor` wiring by reusing the same
 * provider-call path — the payload shape is compatible (we coerce
 * preview fields into the `{ title, starts_at, ends_at, location }`
 * contract).
 */

import { type CalendarProvider } from '@homehub/providers-calendar';
import { z } from 'zod';

import { throwAsExecutorError } from '../classifyProviderError.js';
import { coerceRecord, PermanentExecutorError, toPayloadInvalidError } from '../errors.js';
import { resolveConnection } from '../resolveConnection.js';
import { type ActionExecutor, type ExecutorDeps } from '../types.js';

export const outingIdeaPayloadSchema = z.object({
  title: z.string().min(1),
  starts_at: z.string().min(1),
  ends_at: z.string().optional(),
  location: z.string().optional(),
  description: z.string().optional(),
  attendees: z.array(z.string()).optional().default([]),
  mirror_to_gcal: z.boolean().optional().default(true),
});

export type OutingIdeaPayload = z.infer<typeof outingIdeaPayloadSchema>;

export interface CreateOutingIdeaExecutorArgs {
  calendar: CalendarProvider;
  supabase: ExecutorDeps['supabase'];
}

export function createOutingIdeaExecutor(deps: CreateOutingIdeaExecutorArgs): ActionExecutor {
  return async ({ action, suggestion, log }) => {
    const payloadCandidate = {
      ...coerceRecord(suggestion.preview),
      ...coerceRecord(action.payload),
    };
    let payload: OutingIdeaPayload;
    try {
      payload = outingIdeaPayloadSchema.parse(payloadCandidate);
    } catch (err) {
      throw toPayloadInvalidError(err);
    }

    // Outings default to mirroring. When explicitly disabled the
    // approved suggestion was intent-only — surface a `logged` status
    // with no side effect.
    if (!payload.mirror_to_gcal) {
      log.info('outing_idea: mirror_to_gcal=false; nothing to do');
      return { result: { status: 'logged', mirrored: false } };
    }

    const conn = await resolveConnection(deps.supabase, {
      householdId: action.household_id,
      provider: 'gcal',
    });
    if (!conn) {
      throw new PermanentExecutorError(
        'no_google_calendar_connection',
        `household ${action.household_id} has no active google-calendar connection`,
      );
    }

    try {
      const created = await deps.calendar.createEvent({
        connectionId: conn.connectionId,
        title: payload.title,
        startsAt: payload.starts_at,
        ...(payload.ends_at ? { endsAt: payload.ends_at } : {}),
        ...(payload.location ? { location: payload.location } : {}),
        ...(payload.description ? { description: payload.description } : {}),
        attendees: payload.attendees,
      });
      return {
        result: {
          event_id: created.eventId,
          html_link: created.htmlLink,
          connection_id: conn.connectionRowId,
          mirrored: true,
        },
      };
    } catch (err) {
      if (err instanceof PermanentExecutorError) throw err;
      throwAsExecutorError(err, 'google_calendar_write_failed');
    }
  };
}
