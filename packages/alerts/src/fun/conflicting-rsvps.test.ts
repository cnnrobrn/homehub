/**
 * Unit tests for `detectConflictingRsvps`.
 */

import { describe, expect, it } from 'vitest';

import { detectConflictingRsvps } from './conflicting-rsvps.js';
import { type FunEventRow } from './types.js';

const HOUSEHOLD = 'h-1';
const MEMBER_ALICE = 'm-alice';
const MEMBER_BOB = 'm-bob';

function ev(overrides: Partial<FunEventRow> = {}): FunEventRow {
  return {
    id: 'e-1',
    household_id: HOUSEHOLD,
    segment: 'fun',
    kind: 'outing',
    title: 'Movie night',
    starts_at: '2026-04-25T19:00:00Z',
    ends_at: '2026-04-25T21:00:00Z',
    all_day: false,
    location: null,
    owner_member_id: MEMBER_ALICE,
    metadata: {},
    ...overrides,
  };
}

describe('detectConflictingRsvps', () => {
  const now = new Date('2026-04-22T10:00:00Z');

  it('flags two non-trip events on the same day that overlap', () => {
    const out = detectConflictingRsvps({
      householdId: HOUSEHOLD,
      now,
      events: [
        ev({
          id: 'e-1',
          title: 'Movie',
          starts_at: '2026-04-25T19:00:00Z',
          ends_at: '2026-04-25T21:00:00Z',
        }),
        ev({
          id: 'e-2',
          title: 'Dinner',
          starts_at: '2026-04-25T20:00:00Z',
          ends_at: '2026-04-25T22:00:00Z',
        }),
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe('warn');
    expect(out[0]!.kind).toBe('conflicting_rsvps');
    expect(out[0]!.dedupeKey).toBe(`2026-04-25-${MEMBER_ALICE}`);
    expect(out[0]!.context.event_ids).toEqual(['e-1', 'e-2']);
  });

  it('does not flag events that belong to the same trip', () => {
    const out = detectConflictingRsvps({
      householdId: HOUSEHOLD,
      now,
      events: [
        ev({ id: 'e-1', title: 'Flight', metadata: { trip_id: 'trip-1' } }),
        ev({ id: 'e-2', title: 'Hotel check-in', metadata: { trip_id: 'trip-1' } }),
      ],
    });
    expect(out).toHaveLength(0);
  });

  it('does not flag back-to-back non-overlapping events', () => {
    const out = detectConflictingRsvps({
      householdId: HOUSEHOLD,
      now,
      events: [
        ev({ id: 'e-1', starts_at: '2026-04-25T18:00:00Z', ends_at: '2026-04-25T19:00:00Z' }),
        ev({ id: 'e-2', starts_at: '2026-04-25T19:00:00Z', ends_at: '2026-04-25T20:00:00Z' }),
      ],
    });
    expect(out).toHaveLength(0);
  });

  it('groups by member — different members overlapping does not fire', () => {
    const out = detectConflictingRsvps({
      householdId: HOUSEHOLD,
      now,
      events: [
        ev({ id: 'e-1', owner_member_id: MEMBER_ALICE }),
        ev({ id: 'e-2', owner_member_id: MEMBER_BOB }),
      ],
    });
    expect(out).toHaveLength(0);
  });

  it('ignores non-fun segments', () => {
    const out = detectConflictingRsvps({
      householdId: HOUSEHOLD,
      now,
      events: [ev({ id: 'e-1' }), ev({ id: 'e-2', segment: 'financial' })],
    });
    expect(out).toHaveLength(0);
  });

  it('ignores events beyond the lookahead window', () => {
    const out = detectConflictingRsvps({
      householdId: HOUSEHOLD,
      now,
      lookaheadDays: 1,
      events: [
        ev({ id: 'e-1', starts_at: '2026-04-25T19:00:00Z', ends_at: '2026-04-25T21:00:00Z' }),
        ev({ id: 'e-2', starts_at: '2026-04-25T20:00:00Z', ends_at: '2026-04-25T22:00:00Z' }),
      ],
    });
    expect(out).toHaveLength(0);
  });

  it('ignores past events', () => {
    const out = detectConflictingRsvps({
      householdId: HOUSEHOLD,
      now,
      events: [
        ev({ id: 'e-1', starts_at: '2026-04-10T19:00:00Z', ends_at: '2026-04-10T21:00:00Z' }),
        ev({ id: 'e-2', starts_at: '2026-04-10T20:00:00Z', ends_at: '2026-04-10T22:00:00Z' }),
      ],
    });
    expect(out).toHaveLength(0);
  });

  it('dedupe key stable across event re-ordering', () => {
    const args1 = {
      householdId: HOUSEHOLD,
      now,
      events: [
        ev({ id: 'e-1', title: 'A' }),
        ev({ id: 'e-2', title: 'B', starts_at: '2026-04-25T20:00:00Z' }),
      ],
    };
    const args2 = {
      householdId: HOUSEHOLD,
      now,
      events: [...args1.events].reverse(),
    };
    const out1 = detectConflictingRsvps(args1);
    const out2 = detectConflictingRsvps(args2);
    expect(out1[0]!.dedupeKey).toBe(out2[0]!.dedupeKey);
  });
});
