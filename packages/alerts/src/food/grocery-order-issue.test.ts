/**
 * Unit tests for `detectGroceryOrderIssue`.
 */

import { describe, expect, it } from 'vitest';

import { detectGroceryOrderIssue } from './grocery-order-issue.js';
import { type GroceryListRow } from './types.js';

const HOUSEHOLD = 'h-1';

function list(overrides: Partial<GroceryListRow> = {}): GroceryListRow {
  return {
    id: 'g-1',
    household_id: HOUSEHOLD,
    planned_for: '2026-04-25',
    status: 'cancelled',
    provider: 'instacart',
    external_order_id: 'oid-1',
    updated_at: '2026-04-20T10:00:00Z',
    created_at: '2026-04-19T00:00:00Z',
    ...overrides,
  };
}

describe('detectGroceryOrderIssue', () => {
  const now = new Date('2026-04-20T12:00:00Z');

  it('emits warn for a cancelled list updated within 24h', () => {
    const out = detectGroceryOrderIssue({
      householdId: HOUSEHOLD,
      lists: [list()],
      now,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('grocery_order_issue');
    expect(out[0]!.severity).toBe('warn');
    expect(out[0]!.dedupeKey).toBe('g-1');
  });

  it('ignores cancelled lists older than 24h', () => {
    const out = detectGroceryOrderIssue({
      householdId: HOUSEHOLD,
      lists: [list({ updated_at: '2026-04-18T10:00:00Z' })],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('ignores non-cancelled lists', () => {
    const out = detectGroceryOrderIssue({
      householdId: HOUSEHOLD,
      lists: [list({ status: 'ordered' })],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('respects household scoping', () => {
    const out = detectGroceryOrderIssue({
      householdId: HOUSEHOLD,
      lists: [list({ household_id: 'other' })],
      now,
    });
    expect(out).toHaveLength(0);
  });
});
