/**
 * Unit tests for the trip resolver.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  createTripFromEvents,
  resolveTripParent,
  type TripResolverEvent,
} from './trip-resolver.js';

const HOUSEHOLD = 'h-1';

function ev(overrides: Partial<TripResolverEvent> = {}): TripResolverEvent {
  return {
    id: 'e-1',
    household_id: HOUSEHOLD,
    segment: 'fun',
    kind: 'reservation',
    title: 'Reservation',
    starts_at: '2026-05-01T14:00:00Z',
    ends_at: '2026-05-01T16:00:00Z',
    location: 'Montreal, QC',
    metadata: {},
    ...overrides,
  };
}

describe('resolveTripParent', () => {
  it('returns the trip id when the event falls inside an existing trip window', () => {
    const trip = ev({
      id: 'trip-1',
      kind: 'trip',
      starts_at: '2026-05-01T00:00:00Z',
      ends_at: '2026-05-05T23:59:59Z',
    });
    const child = ev({ id: 'e-2', starts_at: '2026-05-03T10:00:00Z' });
    expect(resolveTripParent({ event: child, existingTrips: [trip] })).toBe('trip-1');
  });

  it('returns null when the event is outside any existing trip window', () => {
    const trip = ev({
      id: 'trip-1',
      kind: 'trip',
      starts_at: '2026-05-01T00:00:00Z',
      ends_at: '2026-05-05T23:59:59Z',
    });
    const other = ev({ id: 'e-2', starts_at: '2026-06-10T10:00:00Z' });
    expect(resolveTripParent({ event: other, existingTrips: [trip] })).toBeNull();
  });

  it('returns existing trip_id from metadata when present', () => {
    const child = ev({
      id: 'e-2',
      starts_at: '2026-06-10T10:00:00Z',
      metadata: { trip_id: 'trip-known' },
    });
    expect(resolveTripParent({ event: child, existingTrips: [] })).toBe('trip-known');
  });

  it('ignores trips from other households', () => {
    const trip = ev({
      id: 'trip-1',
      household_id: 'h-other',
      kind: 'trip',
      starts_at: '2026-05-01T00:00:00Z',
      ends_at: '2026-05-05T23:59:59Z',
    });
    const child = ev({ id: 'e-2', starts_at: '2026-05-03T10:00:00Z' });
    expect(resolveTripParent({ event: child, existingTrips: [trip] })).toBeNull();
  });

  it('returns null for non-fun events', () => {
    const trip = ev({
      id: 'trip-1',
      kind: 'trip',
      starts_at: '2026-05-01T00:00:00Z',
      ends_at: '2026-05-05T23:59:59Z',
    });
    const child = ev({ id: 'e-2', segment: 'financial', starts_at: '2026-05-03T10:00:00Z' });
    expect(resolveTripParent({ event: child, existingTrips: [trip] })).toBeNull();
  });
});

describe('createTripFromEvents', () => {
  let counter = 0;
  const idFactory = () => `trip-${++counter}`;

  beforeEach(() => {
    counter = 0;
  });

  it('materializes a trip when ≥3 trip-ish events cluster in a 5-day window', () => {
    const out = createTripFromEvents({
      householdId: HOUSEHOLD,
      existingTrips: [],
      idFactory,
      events: [
        ev({
          id: 'e-1',
          kind: 'flight',
          starts_at: '2026-05-01T14:00:00Z',
          ends_at: '2026-05-01T18:00:00Z',
        }),
        ev({ id: 'e-2', kind: 'hotel_checkin', starts_at: '2026-05-01T20:00:00Z', ends_at: null }),
        ev({
          id: 'e-3',
          kind: 'reservation',
          starts_at: '2026-05-02T14:00:00Z',
          ends_at: '2026-05-02T16:00:00Z',
        }),
        ev({
          id: 'e-4',
          kind: 'activity',
          starts_at: '2026-05-03T10:00:00Z',
          ends_at: '2026-05-03T12:00:00Z',
        }),
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.childEventIds).toEqual(['e-1', 'e-2', 'e-3', 'e-4']);
    expect(out[0]!.tripId).toBe('trip-1');
    expect(out[0]!.isNew).toBe(true);
    expect(out[0]!.title).toContain('Montreal');
  });

  it('does not cluster fewer than 3 events', () => {
    const out = createTripFromEvents({
      householdId: HOUSEHOLD,
      existingTrips: [],
      idFactory,
      events: [
        ev({ id: 'e-1', kind: 'flight', starts_at: '2026-05-01T14:00:00Z' }),
        ev({ id: 'e-2', kind: 'reservation', starts_at: '2026-05-02T14:00:00Z' }),
      ],
    });
    expect(out).toHaveLength(0);
  });

  it('splits clusters that are further than 5 days apart', () => {
    const out = createTripFromEvents({
      householdId: HOUSEHOLD,
      existingTrips: [],
      idFactory,
      events: [
        ev({ id: 'e-1', kind: 'flight', starts_at: '2026-05-01T14:00:00Z' }),
        ev({ id: 'e-2', kind: 'reservation', starts_at: '2026-05-02T14:00:00Z' }),
        ev({ id: 'e-3', kind: 'activity', starts_at: '2026-05-03T14:00:00Z' }),
        // Gap ≥ 5d
        ev({ id: 'e-4', kind: 'flight', starts_at: '2026-05-20T14:00:00Z' }),
        ev({ id: 'e-5', kind: 'reservation', starts_at: '2026-05-21T14:00:00Z' }),
        ev({ id: 'e-6', kind: 'activity', starts_at: '2026-05-22T14:00:00Z' }),
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0]!.childEventIds).toEqual(['e-1', 'e-2', 'e-3']);
    expect(out[1]!.childEventIds).toEqual(['e-4', 'e-5', 'e-6']);
  });

  it('skips events already attached to an existing trip', () => {
    const existing = ev({
      id: 'trip-existing',
      kind: 'trip',
      starts_at: '2026-05-01T00:00:00Z',
      ends_at: '2026-05-05T00:00:00Z',
    });
    const out = createTripFromEvents({
      householdId: HOUSEHOLD,
      existingTrips: [existing],
      idFactory,
      events: [
        ev({
          id: 'e-1',
          kind: 'flight',
          starts_at: '2026-05-01T14:00:00Z',
          metadata: { trip_id: 'trip-existing' },
        }),
        ev({
          id: 'e-2',
          kind: 'reservation',
          starts_at: '2026-05-02T14:00:00Z',
          metadata: { trip_id: 'trip-existing' },
        }),
        ev({
          id: 'e-3',
          kind: 'activity',
          starts_at: '2026-05-03T14:00:00Z',
          metadata: { trip_id: 'trip-existing' },
        }),
      ],
    });
    expect(out).toHaveLength(0);
  });

  it('filters events to the requested household', () => {
    const out = createTripFromEvents({
      householdId: HOUSEHOLD,
      existingTrips: [],
      idFactory,
      events: [
        ev({
          id: 'e-1',
          household_id: 'h-other',
          kind: 'flight',
          starts_at: '2026-05-01T14:00:00Z',
        }),
        ev({
          id: 'e-2',
          household_id: 'h-other',
          kind: 'reservation',
          starts_at: '2026-05-02T14:00:00Z',
        }),
        ev({
          id: 'e-3',
          household_id: 'h-other',
          kind: 'activity',
          starts_at: '2026-05-03T14:00:00Z',
        }),
      ],
    });
    expect(out).toHaveLength(0);
  });

  it('uses the shared location when all events share one', () => {
    const out = createTripFromEvents({
      householdId: HOUSEHOLD,
      existingTrips: [],
      idFactory,
      events: [
        ev({ id: 'e-1', kind: 'flight', starts_at: '2026-05-01T14:00:00Z', location: 'Paris, FR' }),
        ev({
          id: 'e-2',
          kind: 'reservation',
          starts_at: '2026-05-02T14:00:00Z',
          location: 'Paris, FR',
        }),
        ev({
          id: 'e-3',
          kind: 'activity',
          starts_at: '2026-05-03T14:00:00Z',
          location: 'Paris, FR',
        }),
      ],
    });
    expect(out[0]!.location).toBe('Paris, FR');
    expect(out[0]!.title).toBe('Trip to Paris, FR');
  });

  it('ignores non-trip-ish kinds', () => {
    const out = createTripFromEvents({
      householdId: HOUSEHOLD,
      existingTrips: [],
      idFactory,
      events: [
        ev({ id: 'e-1', kind: 'hobby_block', starts_at: '2026-05-01T14:00:00Z' }),
        ev({ id: 'e-2', kind: 'hobby_block', starts_at: '2026-05-02T14:00:00Z' }),
        ev({ id: 'e-3', kind: 'hobby_block', starts_at: '2026-05-03T14:00:00Z' }),
      ],
    });
    expect(out).toHaveLength(0);
  });
});
