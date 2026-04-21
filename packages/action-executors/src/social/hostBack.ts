/**
 * Executor for the `host_back` action kind.
 *
 * Creates an `app.event` row with `segment='social'`,
 * `kind='hosting_back'`, and `metadata.person_node_id`. When the
 * approved preview carries `mirror_to_gcal=true`, we also call the
 * shared `createEvent` path on Google Calendar so the reciprocal-host
 * event lands on the member's calendar alongside the native row.
 */

import { type Json } from '@homehub/db';
import { type CalendarProvider } from '@homehub/providers-calendar';
import { z } from 'zod';

import { throwAsExecutorError } from '../classifyProviderError.js';
import { coerceRecord, PermanentExecutorError, toPayloadInvalidError } from '../errors.js';
import { resolveConnection } from '../resolveConnection.js';
import { type ActionExecutor, type ExecutorDeps } from '../types.js';

export const hostBackPayloadSchema = z.object({
  person_node_id: z.string().uuid(),
  title: z.string().min(1),
  starts_at: z.string().min(1),
  ends_at: z.string().optional(),
  location: z.string().optional(),
  description: z.string().optional(),
  attendees: z.array(z.string()).optional().default([]),
  mirror_to_gcal: z.boolean().optional(),
});

export type HostBackPayload = z.infer<typeof hostBackPayloadSchema>;

export interface CreateHostBackExecutorArgs {
  supabase: ExecutorDeps['supabase'];
  calendar: CalendarProvider;
  now?: () => Date;
}

export function createHostBackExecutor(deps: CreateHostBackExecutorArgs): ActionExecutor {
  const now = deps.now ?? (() => new Date());
  return async ({ action, suggestion, log }) => {
    const payloadCandidate = {
      ...coerceRecord(suggestion.preview),
      ...coerceRecord(action.payload),
    };
    let payload: HostBackPayload;
    try {
      payload = hostBackPayloadSchema.parse(payloadCandidate);
    } catch (err) {
      throw toPayloadInvalidError(err);
    }

    const stamp = now().toISOString();
    const metadata: Record<string, unknown> = {
      person_node_id: payload.person_node_id,
      ...(payload.description ? { description: payload.description } : {}),
      ...(payload.attendees.length > 0 ? { attendees: payload.attendees } : {}),
    };

    const { data: inserted, error: insErr } = await deps.supabase
      .schema('app')
      .from('event')
      .insert({
        household_id: action.household_id,
        segment: 'social',
        kind: 'hosting_back',
        title: payload.title,
        starts_at: payload.starts_at,
        ends_at: payload.ends_at ?? null,
        all_day: false,
        location: payload.location ?? null,
        metadata: metadata as unknown as Json,
        updated_at: stamp,
      })
      .select('id')
      .single();
    if (insErr || !inserted) {
      throw new Error(`app.event insert failed: ${insErr?.message ?? 'no row returned'}`);
    }
    const eventId = (inserted as { id: string }).id;
    if (!eventId) {
      throw new PermanentExecutorError(
        'event_insert_missing_id',
        'app.event insert did not return an id',
      );
    }

    let gcalResult: { event_id: string; html_link: string } | null = null;
    if (payload.mirror_to_gcal) {
      const conn = await resolveConnection(deps.supabase, {
        householdId: action.household_id,
        provider: 'gcal',
      });
      if (!conn) {
        log.warn('host_back: mirror_to_gcal requested but no gcal connection; skipping');
      } else {
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
          gcalResult = { event_id: created.eventId, html_link: created.htmlLink };
        } catch (err) {
          if (err instanceof PermanentExecutorError) throw err;
          throwAsExecutorError(err, 'google_calendar_write_failed');
        }
      }
    }

    log.info('host_back event created', {
      event_id: eventId,
      mirrored_to_gcal: Boolean(gcalResult),
    });

    return {
      result: {
        event_id: eventId,
        ...(gcalResult ? { gcal: gcalResult } : {}),
      },
    };
  };
}
