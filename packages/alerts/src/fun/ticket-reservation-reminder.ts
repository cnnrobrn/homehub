/**
 * `ticket_reservation_reminder` detector.
 *
 * Spec: `specs/06-segments/fun/summaries-alerts.md` —
 * "Upcoming ticket / reservation without prep details."
 *
 * Algorithm: emit `info` for every event with `kind='reservation'` (or
 * `kind='ticketed_event'`) whose `starts_at` is within the next 24h.
 *
 * Dedupe key: `${eventId}`.
 */

import { type AlertEmission } from '../types.js';

import { type FunEventRow } from './types.js';

export const RESERVATION_REMINDER_LOOKAHEAD_HOURS = 24;
const RESERVATION_KINDS = new Set(['reservation', 'ticketed_event', 'concert', 'show']);

export interface TicketReservationReminderInput {
  householdId: string;
  events: FunEventRow[];
  now: Date;
}

export function detectTicketReservationReminder(
  input: TicketReservationReminderInput,
): AlertEmission[] {
  const horizonMs = input.now.getTime() + RESERVATION_REMINDER_LOOKAHEAD_HOURS * 60 * 60 * 1000;
  const out: AlertEmission[] = [];

  for (const event of input.events) {
    if (event.household_id !== input.householdId) continue;
    if (event.segment !== 'fun') continue;
    if (!RESERVATION_KINDS.has(event.kind)) continue;
    const startMs = new Date(event.starts_at).getTime();
    if (!Number.isFinite(startMs)) continue;
    if (startMs < input.now.getTime() || startMs > horizonMs) continue;

    const hoursAway = Math.max(0, Math.round((startMs - input.now.getTime()) / (60 * 60 * 1000)));
    const whenLabel =
      hoursAway <= 1 ? 'within the hour' : hoursAway >= 24 ? 'tomorrow' : `in ${hoursAway} hours`;

    out.push({
      segment: 'fun',
      severity: 'info',
      kind: 'ticket_reservation_reminder',
      dedupeKey: event.id,
      title: `Upcoming ${event.kind.replace(/_/g, ' ')}: ${event.title}`,
      body: `"${event.title}" is ${whenLabel}. Check tickets, reservation details, and departure time.`,
      context: {
        event_id: event.id,
        kind: event.kind,
        starts_at: event.starts_at,
        location: event.location,
      },
    });
  }
  return out;
}
