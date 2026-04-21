/**
 * `trip_prep` generator.
 *
 * Spec: `specs/06-segments/fun/suggestions-coordination.md` — "Upcoming
 * trip; draft packing list / tasks."
 *
 * Algorithm:
 *   - For each upcoming trip parent event (`kind='trip'`) within 14
 *     days, emit one `trip_prep` suggestion with a default checklist
 *     (weather check, packing, confirmations, docs).
 *   - The caller can polish the rationale via a RationaleWriter.
 *
 * Dedupe key: `${tripId}`.
 */

import { type SuggestionEmission } from '../types.js';

export const TRIP_PREP_DEFAULT_CHECKLIST = [
  'Check weather forecast',
  'Confirm flights, hotels, reservations',
  'Pack clothes + toiletries',
  'Bring passport / ID and any tickets',
  'Set up autoreply for email',
  'Arrange pet / plant care if needed',
];

export interface TripPrepTrip {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  household_id: string;
  segment: string;
  kind: string;
}

export interface TripPrepInput {
  householdId: string;
  now: Date;
  trips: ReadonlyArray<TripPrepTrip>;
  /** Cap. Default 5. */
  maxSuggestions?: number;
  /** Lookahead window. Default 14d. */
  lookaheadDays?: number;
}

export function generateTripPrep(input: TripPrepInput): SuggestionEmission[] {
  const lookahead = input.lookaheadDays ?? 14;
  const max = input.maxSuggestions ?? 5;
  const horizon = input.now.getTime() + lookahead * 24 * 60 * 60 * 1000;
  const out: SuggestionEmission[] = [];

  const sorted = [...input.trips]
    .filter((t) => t.household_id === input.householdId)
    .filter((t) => t.segment === 'fun' && t.kind === 'trip')
    .filter((t) => {
      const start = new Date(t.starts_at).getTime();
      return Number.isFinite(start) && start >= input.now.getTime() && start <= horizon;
    })
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());

  for (const trip of sorted) {
    if (out.length >= max) break;
    const daysAway = Math.max(
      0,
      Math.ceil((new Date(trip.starts_at).getTime() - input.now.getTime()) / (24 * 60 * 60 * 1000)),
    );
    const whenLabel =
      daysAway === 0 ? 'today' : daysAway === 1 ? 'tomorrow' : `in ${daysAway} days`;
    out.push({
      segment: 'fun',
      kind: 'trip_prep',
      title: `Trip prep: ${trip.title}`,
      rationale: `${trip.title} starts ${whenLabel}. Here is a starter checklist to get ready.`,
      preview: {
        trip_id: trip.id,
        starts_at: trip.starts_at,
        ends_at: trip.ends_at,
        location: trip.location,
        checklist: TRIP_PREP_DEFAULT_CHECKLIST,
        dedupe_key: trip.id,
      },
      dedupeKey: trip.id,
    });
  }
  return out;
}
