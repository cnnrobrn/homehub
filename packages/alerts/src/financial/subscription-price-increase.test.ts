/**
 * Unit tests for `detectSubscriptionPriceIncrease`.
 */

import { describe, expect, it } from 'vitest';

import { type SubscriptionNode, type TransactionRow } from '../types.js';

import { detectSubscriptionPriceIncrease } from './subscription-price-increase.js';

const HOUSEHOLD = 'h-1';
const SUB_ID = 'sub-1';

function sub(overrides: Partial<SubscriptionNode> = {}): SubscriptionNode {
  return {
    id: SUB_ID,
    household_id: HOUSEHOLD,
    canonical_name: 'Netflix',
    metadata: { cadence: 'monthly', price_cents: 1599 },
    needs_review: false,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function tx(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: 't-1',
    household_id: HOUSEHOLD,
    account_id: 'a-1',
    occurred_at: '2026-04-10T00:00:00Z',
    amount_cents: -1599,
    currency: 'USD',
    merchant_raw: 'Netflix',
    category: 'Subscriptions',
    source: 'ynab',
    metadata: { recurring_signal: SUB_ID },
    ...overrides,
  };
}

describe('detectSubscriptionPriceIncrease', () => {
  const now = new Date('2026-04-22T00:00:00Z');

  it('emits warn when latest charge is ≥ 5% above prior median', () => {
    const out = detectSubscriptionPriceIncrease({
      householdId: HOUSEHOLD,
      subscriptions: [sub()],
      transactions: [
        tx({ id: 't-1', occurred_at: '2026-02-10T00:00:00Z', amount_cents: -1599 }),
        tx({ id: 't-2', occurred_at: '2026-03-10T00:00:00Z', amount_cents: -1599 }),
        tx({ id: 't-3', occurred_at: '2026-04-10T00:00:00Z', amount_cents: -1799 }), // +12.5%
      ],
      now,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe('warn');
    expect(out[0]!.kind).toBe('subscription_price_increase');
    expect(out[0]!.dedupeKey).toBe(`${SUB_ID}:2026-04`);
    expect(out[0]!.context.latest_amount_cents).toBe(1799);
    expect(out[0]!.context.prior_median_cents).toBe(1599);
  });

  it('no alert when below 5%', () => {
    const out = detectSubscriptionPriceIncrease({
      householdId: HOUSEHOLD,
      subscriptions: [sub()],
      transactions: [
        tx({ id: 't-1', occurred_at: '2026-02-10T00:00:00Z', amount_cents: -1599 }),
        tx({ id: 't-2', occurred_at: '2026-03-10T00:00:00Z', amount_cents: -1599 }),
        tx({ id: 't-3', occurred_at: '2026-04-10T00:00:00Z', amount_cents: -1620 }),
      ],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('no alert with fewer than 2 charges', () => {
    const out = detectSubscriptionPriceIncrease({
      householdId: HOUSEHOLD,
      subscriptions: [sub()],
      transactions: [tx({ id: 't-1', amount_cents: -1599 })],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('ignores transactions not pointing at the subscription', () => {
    const out = detectSubscriptionPriceIncrease({
      householdId: HOUSEHOLD,
      subscriptions: [sub()],
      transactions: [
        tx({ id: 't-1', occurred_at: '2026-02-10T00:00:00Z', metadata: {} }),
        tx({ id: 't-2', occurred_at: '2026-03-10T00:00:00Z', metadata: {} }),
        tx({ id: 't-3', occurred_at: '2026-04-10T00:00:00Z', metadata: {}, amount_cents: -5000 }),
      ],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('ignores subscriptions in other households', () => {
    const out = detectSubscriptionPriceIncrease({
      householdId: HOUSEHOLD,
      subscriptions: [sub({ household_id: 'other' })],
      transactions: [
        tx({ id: 't-1', occurred_at: '2026-02-10T00:00:00Z' }),
        tx({ id: 't-2', occurred_at: '2026-03-10T00:00:00Z' }),
        tx({ id: 't-3', occurred_at: '2026-04-10T00:00:00Z', amount_cents: -2000 }),
      ],
      now,
    });
    expect(out).toHaveLength(0);
  });
});
