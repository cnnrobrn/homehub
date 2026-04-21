/**
 * Unit tests for `detectPantryExpiring`.
 */

import { describe, expect, it } from 'vitest';

import { PANTRY_EXPIRING_DAYS, detectPantryExpiring } from './pantry-expiring.js';
import { type PantryItemRow } from './types.js';

const HOUSEHOLD = 'h-1';

function item(overrides: Partial<PantryItemRow> = {}): PantryItemRow {
  return {
    id: 'p-1',
    household_id: HOUSEHOLD,
    name: 'Spinach',
    quantity: 1,
    unit: 'bag',
    expires_on: '2026-04-23',
    location: 'fridge',
    last_seen_at: null,
    ...overrides,
  };
}

describe('detectPantryExpiring', () => {
  const now = new Date('2026-04-20T12:00:00Z');

  it('emits for an item expiring within the horizon', () => {
    const out = detectPantryExpiring({
      householdId: HOUSEHOLD,
      items: [item({ expires_on: '2026-04-22' })],
      now,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('pantry_expiring');
    expect(out[0]!.severity).toBe('warn');
    expect(out[0]!.dedupeKey).toBe('p-1-2026-04-22');
  });

  it('ignores items beyond the horizon', () => {
    const out = detectPantryExpiring({
      householdId: HOUSEHOLD,
      items: [item({ expires_on: '2026-04-30' })],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('emits for already-expired items', () => {
    const out = detectPantryExpiring({
      householdId: HOUSEHOLD,
      items: [item({ expires_on: '2026-04-18' })],
      now,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toMatch(/expired/i);
  });

  it('ignores items with no expiry date', () => {
    const out = detectPantryExpiring({
      householdId: HOUSEHOLD,
      items: [item({ expires_on: null })],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('respects household scoping', () => {
    const out = detectPantryExpiring({
      householdId: HOUSEHOLD,
      items: [item({ household_id: 'other-hh', expires_on: '2026-04-21' })],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('exports the window constant', () => {
    expect(PANTRY_EXPIRING_DAYS).toBeGreaterThan(0);
  });
});
