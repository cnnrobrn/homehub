/**
 * `conflicting_rsvps` detector.
 *
 * Spec: `specs/06-segments/fun/summaries-alerts.md` — "Two members RSVP
 * yes to overlapping non-joint events."
 *
 * Algorithm:
 *   - Group fun events by `(ownerMemberId, calendarDay)` for events that
 *     overlap in wall-clock time (where "overlap" for point-in-time
 *     events is same-hour bucket).
 *   - Emit a `warn` alert per `(date, memberId)` pair where the same
 *     owner has ≥2 events overlapping in time and they are not the same
 *     trip (shared `trip_id` means the events are intentional sub-events
 *     of a trip, not a conflict).
 *
 * Dedupe key: `${date}-${ownerMemberId}`.
 */

import { type AlertEmission } from '../types.js';

import { type FunEventRow, getTripId } from './types.js';

export interface ConflictingRsvpsInput {
  householdId: string;
  events: FunEventRow[];
  now: Date;
  /** Look-ahead in days. Default: 30. */
  lookaheadDays?: number;
}

export const CONFLICTING_RSVPS_DEFAULT_LOOKAHEAD_DAYS = 30;

export function detectConflictingRsvps(input: ConflictingRsvpsInput): AlertEmission[] {
  const lookaheadDays = input.lookaheadDays ?? CONFLICTING_RSVPS_DEFAULT_LOOKAHEAD_DAYS;
  const cutoff = input.now.getTime() + lookaheadDays * 24 * 60 * 60 * 1000;

  const relevant = input.events.filter((e) => {
    if (e.household_id !== input.householdId) return false;
    if (e.segment !== 'fun') return false;
    if (!e.owner_member_id) return false;
    const startMs = new Date(e.starts_at).getTime();
    if (!Number.isFinite(startMs)) return false;
    if (startMs < input.now.getTime() || startMs > cutoff) return false;
    return true;
  });

  // Group by (memberId, date string YYYY-MM-DD).
  const byBucket = new Map<string, FunEventRow[]>();
  for (const event of relevant) {
    const date = event.starts_at.slice(0, 10);
    const key = `${event.owner_member_id}::${date}`;
    const bucket = byBucket.get(key);
    if (bucket) bucket.push(event);
    else byBucket.set(key, [event]);
  }

  const out: AlertEmission[] = [];
  for (const [bucketKey, bucket] of byBucket) {
    if (bucket.length < 2) continue;
    // Find at least one overlapping pair that is NOT part of the same trip.
    const pairs = findOverlappingPairs(bucket);
    const nonTripPairs = pairs.filter(([a, b]) => {
      const tripA = getTripId(a);
      const tripB = getTripId(b);
      if (tripA && tripB && tripA === tripB) return false;
      return true;
    });
    if (nonTripPairs.length === 0) continue;

    const [, date] = bucketKey.split('::');
    const memberId = bucket[0]!.owner_member_id as string;
    // Pick the earliest pair for the alert context so the evidence is
    // deterministic under resorting.
    const [first, second] = nonTripPairs.sort(
      (x, y) => new Date(x[0].starts_at).getTime() - new Date(y[0].starts_at).getTime(),
    )[0]!;

    out.push({
      segment: 'fun',
      severity: 'warn',
      kind: 'conflicting_rsvps',
      dedupeKey: `${date}-${memberId}`,
      title: `Overlapping plans on ${date}`,
      body: `"${first.title}" and "${second.title}" overlap. Double-check which one you meant to attend.`,
      context: {
        date,
        member_id: memberId,
        event_ids: [first.id, second.id],
        event_titles: [first.title, second.title],
      },
    });
  }

  return out;
}

function findOverlappingPairs(events: FunEventRow[]): Array<[FunEventRow, FunEventRow]> {
  const pairs: Array<[FunEventRow, FunEventRow]> = [];
  const sorted = [...events].sort(
    (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
  );
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      if (overlaps(sorted[i]!, sorted[j]!)) {
        pairs.push([sorted[i]!, sorted[j]!]);
      }
    }
  }
  return pairs;
}

function overlaps(a: FunEventRow, b: FunEventRow): boolean {
  const aStart = new Date(a.starts_at).getTime();
  const aEnd = a.ends_at ? new Date(a.ends_at).getTime() : aStart + 60 * 60 * 1000; // 1h default for point-in-time
  const bStart = new Date(b.starts_at).getTime();
  const bEnd = b.ends_at ? new Date(b.ends_at).getTime() : bStart + 60 * 60 * 1000;
  return aStart < bEnd && bStart < aEnd;
}
