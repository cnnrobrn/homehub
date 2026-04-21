/**
 * Unit tests for `generateBookReservation`.
 */

import { describe, expect, it } from 'vitest';

import {
  BOOK_RESERVATION_MIN_ATTENDED_COUNT,
  generateBookReservation,
  type BookReservationPlaceNode,
} from './book-reservation.js';

const HOUSEHOLD = 'h-1';

function place(overrides: Partial<BookReservationPlaceNode> = {}): BookReservationPlaceNode {
  return {
    id: 'p-1',
    household_id: HOUSEHOLD,
    name: 'Maison',
    category: 'restaurant',
    // Four Friday dinners in a row — 2026-04-03, -10, -17, -24.
    attendedAtIso: [
      '2026-04-03T20:00:00Z',
      '2026-04-10T20:00:00Z',
      '2026-04-17T20:00:00Z',
      '2026-04-24T20:00:00Z',
    ],
    ...overrides,
  };
}

describe('generateBookReservation', () => {
  const now = new Date('2026-04-22T12:00:00Z');

  it('emits a book_reservation for a frequently-attended place', () => {
    const out = generateBookReservation({
      householdId: HOUSEHOLD,
      now,
      places: [place()],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('book_reservation');
    expect(out[0]!.preview.place_node_id).toBe('p-1');
    // Next Friday after 2026-04-22 is 2026-04-24.
    expect(out[0]!.preview.proposed_date).toBe('2026-04-24');
  });

  it(`skips places below the ${BOOK_RESERVATION_MIN_ATTENDED_COUNT}-attend threshold`, () => {
    const out = generateBookReservation({
      householdId: HOUSEHOLD,
      now,
      places: [
        place({
          attendedAtIso: ['2026-04-03T20:00:00Z', '2026-04-10T20:00:00Z'],
        }),
      ],
    });
    expect(out).toHaveLength(0);
  });

  it('ignores other households', () => {
    const out = generateBookReservation({
      householdId: HOUSEHOLD,
      now,
      places: [place({ household_id: 'other' })],
    });
    expect(out).toHaveLength(0);
  });

  it('respects the maxSuggestions cap', () => {
    const out = generateBookReservation({
      householdId: HOUSEHOLD,
      now,
      places: [
        place({ id: 'p1', name: 'One' }),
        place({ id: 'p2', name: 'Two' }),
        place({ id: 'p3', name: 'Three' }),
      ],
      maxSuggestions: 2,
    });
    expect(out).toHaveLength(2);
  });

  it('emits stable dedupe keys on repeat calls', () => {
    const a = generateBookReservation({
      householdId: HOUSEHOLD,
      now,
      places: [place()],
    });
    const b = generateBookReservation({
      householdId: HOUSEHOLD,
      now,
      places: [place()],
    });
    expect(a[0]!.dedupeKey).toBe(b[0]!.dedupeKey);
  });
});
