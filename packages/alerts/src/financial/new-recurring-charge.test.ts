/**
 * Unit tests for `detectNewRecurringCharge`.
 */

import { describe, expect, it } from 'vitest';

import { type SubscriptionNode } from '../types.js';

import { detectNewRecurringCharge } from './new-recurring-charge.js';

const HOUSEHOLD = 'h-1';

function sub(overrides: Partial<SubscriptionNode> = {}): SubscriptionNode {
  return {
    id: 'sub-1',
    household_id: HOUSEHOLD,
    canonical_name: 'Netflix',
    metadata: { cadence: 'monthly', price_cents: 1599 },
    needs_review: false,
    created_at: '2026-04-22T00:00:00Z',
    ...overrides,
  };
}

describe('detectNewRecurringCharge', () => {
  it('emits info for each newly-created subscription', () => {
    const out = detectNewRecurringCharge({
      householdId: HOUSEHOLD,
      newlyCreated: [sub()],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe('info');
    expect(out[0]!.kind).toBe('new_recurring_charge');
    expect(out[0]!.dedupeKey).toBe('sub-1');
    expect(out[0]!.context.canonical_name).toBe('Netflix');
    expect(out[0]!.context.cadence).toBe('monthly');
    expect(out[0]!.context.price_cents).toBe(1599);
  });

  it('works without cadence/price metadata', () => {
    const out = detectNewRecurringCharge({
      householdId: HOUSEHOLD,
      newlyCreated: [sub({ metadata: {} })],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.context.cadence).toBe('recurring');
    expect(out[0]!.context.price_cents).toBe(null);
  });

  it('skips subscriptions in other households', () => {
    const out = detectNewRecurringCharge({
      householdId: HOUSEHOLD,
      newlyCreated: [sub({ household_id: 'other' })],
    });
    expect(out).toHaveLength(0);
  });

  it('empty input returns empty', () => {
    const out = detectNewRecurringCharge({ householdId: HOUSEHOLD, newlyCreated: [] });
    expect(out).toHaveLength(0);
  });
});
