/**
 * Unit tests for `detectUpcomingTripPrep`.
 */

import { describe, expect, it } from 'vitest';

import { type FunEventRow } from './types.js';
import { detectUpcomingTripPrep, TRIP_PREP_LOOKAHEAD_DAYS } from './upcoming-trip-prep.js';

const HOUSEHOLD = 'h-1';

function trip(overrides: Partial<FunEventRow> = {}): FunEventRow {
  return {
    id: 'trip-1',
    household_id: HOUSEHOLD,
    segment: 'fun',
    kind: 'trip',
    title: 'Weekend in Montreal',
    starts_at: '2026-04-26T08:00:00Z',
    ends_at: '2026-04-28T22:00:00Z',
    all_day: false,
    location: 'Montreal, QC',
    owner_member_id: 'm-1',
    metadata: { trip_id: 'trip-1' },
    ...overrides,
  };
}

describe('detectUpcomingTripPrep', () => {
  const now = new Date('2026-04-22T12:00:00Z');

  it('emits info for trips within the 7-day window', () => {
    const out = detectUpcomingTripPrep({
      householdId: HOUSEHOLD,
      trips: [trip()],
      now,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe('info');
    expect(out[0]!.kind).toBe('upcoming_trip_prep');
    expect(out[0]!.dedupeKey).toBe('trip-1');
    expect(out[0]!.context.trip_id).toBe('trip-1');
  });

  it('ignores trips further out than the lookahead', () => {
    const out = detectUpcomingTripPrep({
      householdId: HOUSEHOLD,
      trips: [trip({ starts_at: '2026-05-30T08:00:00Z', ends_at: '2026-06-02T22:00:00Z' })],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it(`honors a ${TRIP_PREP_LOOKAHEAD_DAYS}-day window`, () => {
    // Trip exactly 7d out → within window.
    const out = detectUpcomingTripPrep({
      householdId: HOUSEHOLD,
      trips: [trip({ starts_at: '2026-04-29T12:00:00Z' })],
      now,
    });
    expect(out).toHaveLength(1);
  });

  it('ignores trips that have already started', () => {
    const out = detectUpcomingTripPrep({
      householdId: HOUSEHOLD,
      trips: [trip({ starts_at: '2026-04-21T08:00:00Z' })],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('ignores non-trip events', () => {
    const out = detectUpcomingTripPrep({
      householdId: HOUSEHOLD,
      trips: [trip({ kind: 'outing' })],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('ignores other households', () => {
    const out = detectUpcomingTripPrep({
      householdId: HOUSEHOLD,
      trips: [trip({ household_id: 'h-other' })],
      now,
    });
    expect(out).toHaveLength(0);
  });
});
