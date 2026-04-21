/**
 * Unit tests for `detectDuplicateCharge`.
 */

import { describe, expect, it } from 'vitest';

import { type TransactionRow } from '../types.js';

import { detectDuplicateCharge, DUPLICATE_TIME_WINDOW_HOURS } from './duplicate-charge.js';

const HOUSEHOLD = 'h-1';

function tx(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: 't-1',
    household_id: HOUSEHOLD,
    account_id: 'a-1',
    occurred_at: '2026-04-22T10:00:00Z',
    amount_cents: -42_00,
    currency: 'USD',
    merchant_raw: 'Chipotle',
    category: 'Dining',
    source: 'ynab',
    metadata: {},
    ...overrides,
  };
}

describe('detectDuplicateCharge', () => {
  const now = new Date('2026-04-22T23:59:00Z');

  it('flags duplicate within 24h, same amount, same merchant', () => {
    const out = detectDuplicateCharge({
      householdId: HOUSEHOLD,
      transactions: [
        tx({ id: 't-1', occurred_at: '2026-04-22T10:00:00Z' }),
        tx({ id: 't-2', occurred_at: '2026-04-22T14:00:00Z' }),
      ],
      now,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.dedupeKey).toBe('t-2');
    expect(out[0]!.severity).toBe('warn');
    expect(out[0]!.context.paired_transaction_id).toBe('t-1');
  });

  it('does not flag across accounts', () => {
    const out = detectDuplicateCharge({
      householdId: HOUSEHOLD,
      transactions: [tx({ id: 't-1', account_id: 'a-1' }), tx({ id: 't-2', account_id: 'a-2' })],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('does not flag different merchants', () => {
    const out = detectDuplicateCharge({
      householdId: HOUSEHOLD,
      transactions: [
        tx({ id: 't-1', merchant_raw: 'Chipotle' }),
        tx({ id: 't-2', merchant_raw: 'Whole Foods' }),
      ],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('does not flag different amounts (> 1 cent)', () => {
    const out = detectDuplicateCharge({
      householdId: HOUSEHOLD,
      transactions: [
        tx({ id: 't-1', amount_cents: -42_00 }),
        tx({ id: 't-2', amount_cents: -45_00 }),
      ],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('allows matches within 1 cent', () => {
    const out = detectDuplicateCharge({
      householdId: HOUSEHOLD,
      transactions: [
        tx({ id: 't-1', amount_cents: -42_00 }),
        tx({ id: 't-2', amount_cents: -41_99 }),
      ],
      now,
    });
    expect(out).toHaveLength(1);
  });

  it(`does not flag across more than ${DUPLICATE_TIME_WINDOW_HOURS}h`, () => {
    const out = detectDuplicateCharge({
      householdId: HOUSEHOLD,
      transactions: [
        tx({ id: 't-1', occurred_at: '2026-04-20T10:00:00Z' }),
        tx({ id: 't-2', occurred_at: '2026-04-22T10:00:00Z' }),
      ],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('normalizes merchant (case and punctuation)', () => {
    const out = detectDuplicateCharge({
      householdId: HOUSEHOLD,
      transactions: [
        tx({ id: 't-1', merchant_raw: 'Chipotle #4242' }),
        tx({ id: 't-2', merchant_raw: 'CHIPOTLE 4242' }),
      ],
      now,
    });
    expect(out).toHaveLength(1);
  });

  it('ignores transactions with null merchant', () => {
    const out = detectDuplicateCharge({
      householdId: HOUSEHOLD,
      transactions: [tx({ id: 't-1', merchant_raw: null }), tx({ id: 't-2', merchant_raw: null })],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('ignores transactions with no account_id', () => {
    const out = detectDuplicateCharge({
      householdId: HOUSEHOLD,
      transactions: [tx({ id: 't-1', account_id: null }), tx({ id: 't-2', account_id: null })],
      now,
    });
    expect(out).toHaveLength(0);
  });
});
