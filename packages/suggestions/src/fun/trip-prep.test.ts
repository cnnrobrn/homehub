/**
 * Unit tests for `generateTripPrep`.
 */

import { describe, expect, it } from 'vitest';

import { TRIP_PREP_DEFAULT_CHECKLIST, generateTripPrep, type TripPrepTrip } from './trip-prep.js';

const HOUSEHOLD = 'h-1';

function trip(overrides: Partial<TripPrepTrip> = {}): TripPrepTrip {
  return {
    id: 'trip-1',
    household_id: HOUSEHOLD,
    segment: 'fun',
    kind: 'trip',
    title: 'Weekend in Montreal',
    starts_at: '2026-04-26T08:00:00Z',
    ends_at: '2026-04-28T22:00:00Z',
    location: 'Montreal, QC',
    ...overrides,
  };
}

describe('generateTripPrep', () => {
  const now = new Date('2026-04-22T12:00:00Z');

  it('emits one suggestion per upcoming trip', () => {
    const out = generateTripPrep({
      householdId: HOUSEHOLD,
      now,
      trips: [trip()],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('trip_prep');
    expect(out[0]!.dedupeKey).toBe('trip-1');
    expect(out[0]!.preview.checklist).toEqual(TRIP_PREP_DEFAULT_CHECKLIST);
  });

  it('ignores trips outside the lookahead', () => {
    const out = generateTripPrep({
      householdId: HOUSEHOLD,
      now,
      trips: [trip({ starts_at: '2026-07-15T08:00:00Z' })],
      lookaheadDays: 14,
    });
    expect(out).toHaveLength(0);
  });

  it('ignores past trips', () => {
    const out = generateTripPrep({
      householdId: HOUSEHOLD,
      now,
      trips: [trip({ starts_at: '2026-04-10T08:00:00Z' })],
    });
    expect(out).toHaveLength(0);
  });

  it('ignores non-trip events', () => {
    const out = generateTripPrep({
      householdId: HOUSEHOLD,
      now,
      trips: [trip({ kind: 'outing' })],
    });
    expect(out).toHaveLength(0);
  });

  it('respects the maxSuggestions cap', () => {
    const out = generateTripPrep({
      householdId: HOUSEHOLD,
      now,
      trips: [
        trip({ id: 't1', starts_at: '2026-04-24T08:00:00Z' }),
        trip({ id: 't2', starts_at: '2026-04-25T08:00:00Z' }),
        trip({ id: 't3', starts_at: '2026-04-26T08:00:00Z' }),
      ],
      maxSuggestions: 2,
    });
    expect(out).toHaveLength(2);
  });

  it('filters out other households', () => {
    const out = generateTripPrep({
      householdId: HOUSEHOLD,
      now,
      trips: [trip({ household_id: 'other' })],
    });
    expect(out).toHaveLength(0);
  });
});
