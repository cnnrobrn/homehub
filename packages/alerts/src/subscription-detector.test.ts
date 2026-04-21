/**
 * Unit tests for `detectSubscriptions`.
 */

import { describe, expect, it } from 'vitest';

import { classifyCadence, detectSubscriptions } from './subscription-detector.js';
import { type TransactionRow } from './types.js';

const HOUSEHOLD = 'h-1';

function tx(id: string, occurredAt: string, merchant: string, amountCents: number): TransactionRow {
  return {
    id,
    household_id: HOUSEHOLD,
    account_id: 'a-1',
    occurred_at: occurredAt,
    amount_cents: amountCents,
    currency: 'USD',
    merchant_raw: merchant,
    category: 'Subscriptions',
    source: 'ynab',
    metadata: {},
  };
}

describe('classifyCadence', () => {
  it('detects weekly, monthly, yearly', () => {
    expect(classifyCadence(7)).toBe('weekly');
    expect(classifyCadence(30)).toBe('monthly');
    expect(classifyCadence(365)).toBe('yearly');
  });
  it('tolerates ±1d weekly, ±3d monthly, ±7d yearly', () => {
    expect(classifyCadence(6)).toBe('weekly');
    expect(classifyCadence(8)).toBe('weekly');
    expect(classifyCadence(27)).toBe('monthly');
    expect(classifyCadence(33)).toBe('monthly');
    expect(classifyCadence(358)).toBe('yearly');
    expect(classifyCadence(372)).toBe('yearly');
  });
  it('returns null for unrecognized gaps', () => {
    expect(classifyCadence(15)).toBeNull();
    expect(classifyCadence(100)).toBeNull();
    expect(classifyCadence(3)).toBeNull();
  });
});

describe('detectSubscriptions', () => {
  const now = new Date('2026-04-22T00:00:00Z');

  it('detects a monthly Netflix subscription', () => {
    const out = detectSubscriptions({
      householdId: HOUSEHOLD,
      transactions: [
        tx('t-1', '2026-02-10T00:00:00Z', 'Netflix', -1599),
        tx('t-2', '2026-03-10T00:00:00Z', 'Netflix', -1599),
        tx('t-3', '2026-04-10T00:00:00Z', 'Netflix', -1599),
      ],
      now,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.canonicalName).toBe('Netflix');
    expect(out[0]!.cadence).toBe('monthly');
    expect(out[0]!.priceCents).toBe(1599);
    expect(out[0]!.matchedTransactionIds).toEqual(['t-1', 't-2', 't-3']);
  });

  it('requires at least 3 charges', () => {
    const out = detectSubscriptions({
      householdId: HOUSEHOLD,
      transactions: [
        tx('t-1', '2026-03-10T00:00:00Z', 'Netflix', -1599),
        tx('t-2', '2026-04-10T00:00:00Z', 'Netflix', -1599),
      ],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('requires amounts within ±5%', () => {
    const out = detectSubscriptions({
      householdId: HOUSEHOLD,
      transactions: [
        tx('t-1', '2026-02-10T00:00:00Z', 'Netflix', -1000),
        tx('t-2', '2026-03-10T00:00:00Z', 'Netflix', -1500),
        tx('t-3', '2026-04-10T00:00:00Z', 'Netflix', -2000),
      ],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('ignores irregular cadences', () => {
    const out = detectSubscriptions({
      householdId: HOUSEHOLD,
      transactions: [
        tx('t-1', '2026-01-01T00:00:00Z', 'Netflix', -1599),
        tx('t-2', '2026-01-05T00:00:00Z', 'Netflix', -1599),
        tx('t-3', '2026-04-10T00:00:00Z', 'Netflix', -1599),
      ],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('ignores inflows (income rows should never look like subscriptions)', () => {
    const out = detectSubscriptions({
      householdId: HOUSEHOLD,
      transactions: [
        tx('t-1', '2026-02-10T00:00:00Z', 'Acme Co Payroll', 200000),
        tx('t-2', '2026-03-10T00:00:00Z', 'Acme Co Payroll', 200000),
        tx('t-3', '2026-04-10T00:00:00Z', 'Acme Co Payroll', 200000),
      ],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('ignores rows outside the 90d window', () => {
    const out = detectSubscriptions({
      householdId: HOUSEHOLD,
      transactions: [
        tx('t-1', '2025-10-01T00:00:00Z', 'Netflix', -1599),
        tx('t-2', '2025-11-01T00:00:00Z', 'Netflix', -1599),
        tx('t-3', '2025-12-01T00:00:00Z', 'Netflix', -1599),
      ],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('detects a weekly subscription', () => {
    const out = detectSubscriptions({
      householdId: HOUSEHOLD,
      transactions: [
        tx('t-1', '2026-04-01T00:00:00Z', 'NYT Digital', -400),
        tx('t-2', '2026-04-08T00:00:00Z', 'NYT Digital', -400),
        tx('t-3', '2026-04-15T00:00:00Z', 'NYT Digital', -400),
        tx('t-4', '2026-04-22T00:00:00Z', 'NYT Digital', -400),
      ],
      now,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.cadence).toBe('weekly');
  });

  it('normalizes merchant for grouping (case-insensitive)', () => {
    const out = detectSubscriptions({
      householdId: HOUSEHOLD,
      transactions: [
        tx('t-1', '2026-02-10T00:00:00Z', 'NETFLIX', -1599),
        tx('t-2', '2026-03-10T00:00:00Z', 'Netflix', -1599),
        tx('t-3', '2026-04-10T00:00:00Z', 'netflix', -1599),
      ],
      now,
    });
    expect(out).toHaveLength(1);
  });
});
