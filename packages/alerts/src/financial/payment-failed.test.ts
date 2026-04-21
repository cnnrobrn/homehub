/**
 * Unit tests for `detectPaymentFailed`.
 */

import { describe, expect, it } from 'vitest';

import { type TransactionRow } from '../types.js';

import { detectPaymentFailed, PAYMENT_FAILED_LOOKBACK_DAYS } from './payment-failed.js';

const HOUSEHOLD = 'h-1';

function tx(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: 't-1',
    household_id: HOUSEHOLD,
    account_id: 'a-1',
    occurred_at: '2026-04-22T10:00:00Z',
    amount_cents: -50_00,
    currency: 'USD',
    merchant_raw: 'Comcast',
    category: 'Utilities',
    source: 'ynab',
    metadata: {},
    ...overrides,
  };
}

describe('detectPaymentFailed', () => {
  const now = new Date('2026-04-22T12:00:00Z');

  it('matches explicit payment_failed metadata flag', () => {
    const out = detectPaymentFailed({
      householdId: HOUSEHOLD,
      transactions: [tx({ metadata: { payment_failed: true } })],
      now,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe('critical');
    expect(out[0]!.kind).toBe('payment_failed');
    expect(out[0]!.dedupeKey).toBe('t-1');
  });

  it('matches "failed" in memo', () => {
    const out = detectPaymentFailed({
      householdId: HOUSEHOLD,
      transactions: [tx({ memo: 'ACH payment failed' })],
      now,
    });
    expect(out).toHaveLength(1);
  });

  it('matches "declined" in merchant_raw', () => {
    const out = detectPaymentFailed({
      householdId: HOUSEHOLD,
      transactions: [tx({ merchant_raw: 'Comcast DECLINED' })],
      now,
    });
    expect(out).toHaveLength(1);
  });

  it('matches "returned" case-insensitively', () => {
    const out = detectPaymentFailed({
      householdId: HOUSEHOLD,
      transactions: [tx({ memo: 'Check Returned' })],
      now,
    });
    expect(out).toHaveLength(1);
  });

  it('does not match other words in context', () => {
    const out = detectPaymentFailed({
      householdId: HOUSEHOLD,
      transactions: [tx({ memo: 'normal payment', merchant_raw: 'Comcast' })],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it(`ignores transactions older than ${PAYMENT_FAILED_LOOKBACK_DAYS} days`, () => {
    const out = detectPaymentFailed({
      householdId: HOUSEHOLD,
      transactions: [
        tx({ metadata: { payment_failed: true }, occurred_at: '2026-04-10T00:00:00Z' }),
      ],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('ignores other households', () => {
    const out = detectPaymentFailed({
      householdId: HOUSEHOLD,
      transactions: [tx({ household_id: 'other', metadata: { payment_failed: true } })],
      now,
    });
    expect(out).toHaveLength(0);
  });
});
