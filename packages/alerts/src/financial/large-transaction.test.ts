/**
 * Unit tests for `detectLargeTransaction`.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_HOUSEHOLD_ALERT_SETTINGS, type TransactionRow } from '../types.js';

import { detectLargeTransaction, LARGE_TRANSACTION_LOOKBACK_DAYS } from './large-transaction.js';

const HOUSEHOLD = 'h-1';

function tx(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: 't-1',
    household_id: HOUSEHOLD,
    account_id: 'a-1',
    occurred_at: '2026-04-22T10:00:00Z',
    amount_cents: -600_00,
    currency: 'USD',
    merchant_raw: 'Apple Store',
    category: 'Shopping',
    source: 'ynab',
    metadata: {},
    ...overrides,
  };
}

describe('detectLargeTransaction', () => {
  const now = new Date('2026-04-22T12:00:00Z');

  it('emits info when amount exceeds default threshold', () => {
    const out = detectLargeTransaction({
      householdId: HOUSEHOLD,
      transactions: [tx({ amount_cents: -600_00 })],
      now,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe('info');
    expect(out[0]!.kind).toBe('large_transaction');
    expect(out[0]!.dedupeKey).toBe('t-1');
    expect(out[0]!.context.threshold_cents).toBe(
      DEFAULT_HOUSEHOLD_ALERT_SETTINGS.largeTransactionThresholdCents,
    );
  });

  it('respects a custom household threshold', () => {
    const out = detectLargeTransaction({
      householdId: HOUSEHOLD,
      transactions: [tx({ amount_cents: -250_00 })],
      settings: { largeTransactionThresholdCents: 200_00 },
      now,
    });
    expect(out).toHaveLength(1);
  });

  it('ignores transactions at or below threshold', () => {
    const out = detectLargeTransaction({
      householdId: HOUSEHOLD,
      transactions: [tx({ amount_cents: -500_00 })], // exactly at threshold; not strict >
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('fires on a large inflow too (absolute value)', () => {
    const out = detectLargeTransaction({
      householdId: HOUSEHOLD,
      transactions: [tx({ amount_cents: 800_00 })],
      now,
    });
    expect(out).toHaveLength(1);
  });

  it(`ignores transactions older than ${LARGE_TRANSACTION_LOOKBACK_DAYS} days`, () => {
    const out = detectLargeTransaction({
      householdId: HOUSEHOLD,
      transactions: [tx({ occurred_at: '2026-04-01T10:00:00Z' })],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('ignores other households', () => {
    const out = detectLargeTransaction({
      householdId: HOUSEHOLD,
      transactions: [tx({ household_id: 'other', amount_cents: -600_00 })],
      now,
    });
    expect(out).toHaveLength(0);
  });
});
