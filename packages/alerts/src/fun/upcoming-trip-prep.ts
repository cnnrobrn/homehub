/**
 * `upcoming_trip_prep` detector.
 *
 * Spec: `specs/06-segments/fun/summaries-alerts.md` — "Trip within 7 / 3
 * / 1 days, reminds of prep tasks." For M7 we emit one `info` per trip
 * when the trip starts within the next 7 days.
 *
 * Dedupe key: `${tripId}`. The worker window (24h) keeps the alert from
 * re-firing on subsequent cron runs until the trip starts.
 */

import { type AlertEmission } from '../types.js';

import { type FunEventRow } from './types.js';

export const TRIP_PREP_LOOKAHEAD_DAYS = 7;

export interface UpcomingTripPrepInput {
  householdId: string;
  /**
   * Only parent trip events (`kind='trip'`). The worker is responsible
   * for pre-filtering; the detector asserts only basic shape.
   */
  trips: FunEventRow[];
  now: Date;
}

export function detectUpcomingTripPrep(input: UpcomingTripPrepInput): AlertEmission[] {
  const horizonMs = input.now.getTime() + TRIP_PREP_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000;
  const out: AlertEmission[] = [];

  for (const trip of input.trips) {
    if (trip.household_id !== input.householdId) continue;
    if (trip.kind !== 'trip') continue;
    if (trip.segment !== 'fun') continue;
    const startMs = new Date(trip.starts_at).getTime();
    if (!Number.isFinite(startMs)) continue;
    if (startMs < input.now.getTime() || startMs > horizonMs) continue;

    const daysAway = Math.max(
      0,
      Math.ceil((startMs - input.now.getTime()) / (24 * 60 * 60 * 1000)),
    );
    const whenLabel =
      daysAway === 0 ? 'today' : daysAway === 1 ? 'tomorrow' : `in ${daysAway} days`;

    out.push({
      segment: 'fun',
      severity: 'info',
      kind: 'upcoming_trip_prep',
      dedupeKey: trip.id,
      title: `Trip coming up: ${trip.title}`,
      body: `"${trip.title}" starts ${whenLabel}. Review the packing checklist and confirm reservations.`,
      context: {
        trip_id: trip.id,
        starts_at: trip.starts_at,
        ends_at: trip.ends_at,
        days_away: daysAway,
        location: trip.location,
      },
    });
  }
  return out;
}
