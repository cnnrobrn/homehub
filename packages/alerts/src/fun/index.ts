/**
 * `@homehub/alerts` — fun-segment detectors barrel.
 *
 * Every detector is a pure function over in-memory `FunEventRow` inputs;
 * the alerts worker is responsible for loading + dedupe + persistence.
 */

export { getAttendeeEmails, getTripId, type FunEventRow } from './types.js';

export {
  CONFLICTING_RSVPS_DEFAULT_LOOKAHEAD_DAYS,
  detectConflictingRsvps,
  type ConflictingRsvpsInput,
} from './conflicting-rsvps.js';

export {
  TRIP_PREP_LOOKAHEAD_DAYS,
  detectUpcomingTripPrep,
  type UpcomingTripPrepInput,
} from './upcoming-trip-prep.js';

export {
  RESERVATION_REMINDER_LOOKAHEAD_HOURS,
  detectTicketReservationReminder,
  type TicketReservationReminderInput,
} from './ticket-reservation-reminder.js';
