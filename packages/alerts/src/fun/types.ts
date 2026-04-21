/**
 * Shared types for fun-segment alert detectors.
 *
 * The fun detectors operate over `app.event` rows rather than financial
 * transactions. Keeping a separate `FunEventRow` lets the detectors stay
 * decoupled from `@homehub/db` and allows tests to hand-roll fixtures
 * without a full row shape.
 *
 * `metadata.trip_id` is the canonical pointer that groups a parent-trip
 * event with its children (flights, hotels, reservations). See
 * `specs/06-segments/fun/calendar.md` for the trip data model.
 */

/** Subset of `app.event.Row` the fun-segment detectors consume. */
export interface FunEventRow {
  id: string;
  household_id: string;
  segment: string;
  kind: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  owner_member_id: string | null;
  metadata: Record<string, unknown>;
}

/**
 * Pull the trip id out of an event's metadata, if any. For a parent-trip
 * event, `metadata.trip_id === event.id`.
 */
export function getTripId(event: FunEventRow): string | null {
  const raw = event.metadata?.trip_id;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/**
 * Pull the attendees array out of `metadata.attendees`. Each attendee is a
 * `{ email?, displayName? }` object (matching the gcal shape). The
 * detectors only compare on email today.
 */
export function getAttendeeEmails(event: FunEventRow): string[] {
  const raw = event.metadata?.attendees;
  if (!Array.isArray(raw)) return [];
  const emails: string[] = [];
  for (const entry of raw) {
    if (entry && typeof entry === 'object' && 'email' in entry) {
      const email = (entry as { email?: unknown }).email;
      if (typeof email === 'string' && email.length > 0) {
        emails.push(email.trim().toLowerCase());
      }
    }
  }
  return emails;
}
