/**
 * `book_reservation` generator.
 *
 * Spec: `specs/06-segments/fun/suggestions-coordination.md` — "Repeated
 * pattern (e.g., family dinners out on Fridays); propose booking."
 *
 * Algorithm:
 *   - A `mem.node` of type `place` with ≥3 `attended` edges is a
 *     "frequent place."
 *   - If the place's most-frequent attended day-of-week matches the
 *     next occurrence of that day-of-week (within the next 14 days),
 *     propose a booking.
 *
 * Dedupe key: `${placeId}-${proposedDateYYYY-MM-DD}`.
 */

import { type SuggestionEmission } from '../types.js';

export const BOOK_RESERVATION_MIN_ATTENDED_COUNT = 3;

export interface BookReservationPlaceNode {
  id: string;
  household_id: string;
  name: string;
  /** Last attended ISO timestamps — used to infer the day-of-week rhythm. */
  attendedAtIso: string[];
  /** e.g. "restaurant", "cafe", "museum". */
  category: string | null;
}

export interface BookReservationInput {
  householdId: string;
  now: Date;
  places: ReadonlyArray<BookReservationPlaceNode>;
  /** Cap output. Default 3. */
  maxSuggestions?: number;
}

export function generateBookReservation(input: BookReservationInput): SuggestionEmission[] {
  const max = input.maxSuggestions ?? 3;
  const out: SuggestionEmission[] = [];

  const candidates = [...input.places]
    .filter((p) => p.household_id === input.householdId)
    .filter((p) => p.attendedAtIso.length >= BOOK_RESERVATION_MIN_ATTENDED_COUNT)
    .sort((a, b) => b.attendedAtIso.length - a.attendedAtIso.length);

  for (const place of candidates) {
    if (out.length >= max) break;
    const rhythmDow = modeDayOfWeek(place.attendedAtIso);
    if (rhythmDow === null) continue;
    const nextOccurrence = nextDayOfWeekAfter(input.now, rhythmDow);
    if (!nextOccurrence) continue;

    const dateString = nextOccurrence.toISOString().slice(0, 10);
    out.push({
      segment: 'fun',
      kind: 'book_reservation',
      title: `Book ${place.name}?`,
      rationale: `You've been to ${place.name} ${place.attendedAtIso.length} times — mostly on ${dayName(rhythmDow)}s. Next ${dayName(rhythmDow)} is ${dateString}.`,
      preview: {
        place_node_id: place.id,
        place_name: place.name,
        place_category: place.category,
        attended_count: place.attendedAtIso.length,
        proposed_date: dateString,
        dedupe_key: `${place.id}-${dateString}`,
      },
      dedupeKey: `${place.id}-${dateString}`,
    });
  }

  return out;
}

function modeDayOfWeek(isoList: ReadonlyArray<string>): number | null {
  if (isoList.length === 0) return null;
  const counts = new Array<number>(7).fill(0);
  for (const iso of isoList) {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) continue;
    counts[d.getUTCDay()] = (counts[d.getUTCDay()] ?? 0) + 1;
  }
  let bestIdx = -1;
  let bestCount = 0;
  for (let i = 0; i < counts.length; i += 1) {
    const c = counts[i] ?? 0;
    if (c > bestCount) {
      bestCount = c;
      bestIdx = i;
    }
  }
  return bestIdx === -1 ? null : bestIdx;
}

function nextDayOfWeekAfter(from: Date, targetDow: number): Date | null {
  const out = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  // Advance at least 1 day past `from` so we're proposing future.
  out.setUTCDate(out.getUTCDate() + 1);
  const currentDow = out.getUTCDay();
  const delta = (targetDow - currentDow + 7) % 7;
  out.setUTCDate(out.getUTCDate() + delta);
  // Cap to 14d lookahead.
  if (out.getTime() - from.getTime() > 14 * 24 * 60 * 60 * 1000) return null;
  return out;
}

function dayName(dow: number): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow] ?? '';
}
