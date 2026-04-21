/**
 * Executor for the `add_to_calendar` action kind (and its sibling
 * `propose_add_to_calendar`, which resolves through the same handler —
 * the spec's naming quirk noted in the M9-B briefing).
 *
 * Creates a Google Calendar event on the household's owner-member's
 * primary calendar. The member-approved suggestion's preview has
 * already been hash-verified by the worker; we just translate the
 * validated payload into a provider call.
 */

import { type CalendarProvider } from '@homehub/providers-calendar';
import { z } from 'zod';

import { throwAsExecutorError } from '../classifyProviderError.js';
import { coerceRecord, PermanentExecutorError, toPayloadInvalidError } from '../errors.js';
import { resolveConnection } from '../resolveConnection.js';
import { type ActionExecutor, type ExecutorDeps } from '../types.js';

/**
 * Zod schema for the `add_to_calendar` payload. Every field is
 * validated at the executor boundary so upstream bugs (a malformed
 * preview, a tampered action payload) DLQ rather than crash.
 */
export const addToCalendarPayloadSchema = z.object({
  title: z.string().min(1, 'title is required'),
  starts_at: z.string().min(1, 'starts_at is required'),
  ends_at: z.string().optional(),
  location: z.string().optional(),
  description: z.string().optional(),
  attendees: z.array(z.string()).optional().default([]),
  mirror_to_gcal: z.boolean().optional(),
  send_updates: z.boolean().optional(),
});

export type AddToCalendarPayload = z.infer<typeof addToCalendarPayloadSchema>;

export interface CreateAddToCalendarExecutorArgs {
  calendar: CalendarProvider;
  supabase: ExecutorDeps['supabase'];
}

/**
 * Build the `add_to_calendar` executor. Exposed as a factory so the
 * worker's `registerAllExecutors` can pass the shared `CalendarProvider`
 * + Supabase client in.
 */
export function createAddToCalendarExecutor(deps: CreateAddToCalendarExecutorArgs): ActionExecutor {
  return async ({ action, suggestion, log }) => {
    // Parse the payload; the action payload always has at least the
    // suggestion_hash key, so we read the preview-shaped fields from
    // either `action.payload` OR fall back to `suggestion.preview` when
    // the payload is hash-only. This matches how M8/M7 suggestions
    // flow: the preview is the source of truth, the action payload is
    // hash + optional overrides.
    const payloadCandidate = {
      ...coerceRecord(suggestion.preview),
      ...coerceRecord(action.payload),
    };
    let payload: AddToCalendarPayload;
    try {
      payload = addToCalendarPayloadSchema.parse(payloadCandidate);
    } catch (err) {
      throw toPayloadInvalidError(err);
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

    log.info('creating google calendar event', {
      connection_row_id: conn.connectionRowId,
      attendee_count: payload.attendees.length,
    });

    try {
      const created = await deps.calendar.createEvent({
        connectionId: conn.connectionId,
        title: payload.title,
        startsAt: payload.starts_at,
        ...(payload.ends_at ? { endsAt: payload.ends_at } : {}),
        ...(payload.location ? { location: payload.location } : {}),
        ...(payload.description ? { description: payload.description } : {}),
        attendees: payload.attendees,
        ...(payload.send_updates !== undefined ? { sendUpdates: payload.send_updates } : {}),
      });

      return {
        result: {
          event_id: created.eventId,
          html_link: created.htmlLink,
          connection_id: conn.connectionRowId,
        },
      };
    } catch (err) {
      if (err instanceof PermanentExecutorError) throw err;
      throwAsExecutorError(err, 'google_calendar_write_failed');
    }
  };
}
