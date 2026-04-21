/**
 * Unit tests for `detectTicketReservationReminder`.
 */

import { describe, expect, it } from 'vitest';

import { detectTicketReservationReminder } from './ticket-reservation-reminder.js';
import { type FunEventRow } from './types.js';

const HOUSEHOLD = 'h-1';

function ev(overrides: Partial<FunEventRow> = {}): FunEventRow {
  return {
    id: 'e-1',
    household_id: HOUSEHOLD,
    segment: 'fun',
    kind: 'reservation',
    title: 'Dinner at Maison',
    starts_at: '2026-04-23T02:00:00Z',
    ends_at: '2026-04-23T04:00:00Z',
    all_day: false,
    location: 'Maison Restaurant',
    owner_member_id: 'm-1',
    metadata: {},
    ...overrides,
  };
}

describe('detectTicketReservationReminder', () => {
  const now = new Date('2026-04-22T06:00:00Z');

  it('emits info for reservations within 24h', () => {
    const out = detectTicketReservationReminder({
      householdId: HOUSEHOLD,
      events: [ev()],
      now,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe('info');
    expect(out[0]!.kind).toBe('ticket_reservation_reminder');
    expect(out[0]!.dedupeKey).toBe('e-1');
  });

  it('ignores events outside the 24h window', () => {
    const out = detectTicketReservationReminder({
      householdId: HOUSEHOLD,
      events: [ev({ starts_at: '2026-04-25T12:00:00Z' })],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('ignores kinds that are not reservation-like', () => {
    const out = detectTicketReservationReminder({
      householdId: HOUSEHOLD,
      events: [ev({ kind: 'hobby_block' })],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('fires for ticketed_event kind', () => {
    const out = detectTicketReservationReminder({
      householdId: HOUSEHOLD,
      events: [ev({ kind: 'ticketed_event' })],
      now,
    });
    expect(out).toHaveLength(1);
  });

  it('ignores non-fun segments', () => {
    const out = detectTicketReservationReminder({
      householdId: HOUSEHOLD,
      events: [ev({ segment: 'social' })],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('ignores past events', () => {
    const out = detectTicketReservationReminder({
      householdId: HOUSEHOLD,
      events: [ev({ starts_at: '2026-04-21T23:00:00Z' })],
      now,
    });
    expect(out).toHaveLength(0);
  });
});
