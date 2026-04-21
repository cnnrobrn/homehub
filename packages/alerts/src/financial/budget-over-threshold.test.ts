/**
 * Unit tests for `detectBudgetOverThreshold`.
 */

import { describe, expect, it } from 'vitest';

import { type BudgetRow, type TransactionRow } from '../types.js';

import {
  BUDGET_CRITICAL_PCT,
  BUDGET_WARN_PCT,
  detectBudgetOverThreshold,
  startOfPeriod,
} from './budget-over-threshold.js';

const HOUSEHOLD = 'h-1';

function budget(overrides: Partial<BudgetRow> = {}): BudgetRow {
  return {
    id: 'b-1',
    household_id: HOUSEHOLD,
    name: 'Groceries',
    category: 'Groceries',
    period: 'monthly',
    amount_cents: 500_00,
    currency: 'USD',
    ...overrides,
  };
}

function tx(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: 't-1',
    household_id: HOUSEHOLD,
    account_id: 'a-1',
    occurred_at: '2026-04-10T12:00:00Z',
    amount_cents: -50_00,
    currency: 'USD',
    merchant_raw: 'Trader Joe',
    category: 'Groceries',
    source: 'ynab',
    metadata: {},
    ...overrides,
  };
}

describe('BUDGET_*_PCT constants', () => {
  it('warn=0.8, critical=1.0', () => {
    expect(BUDGET_WARN_PCT).toBe(0.8);
    expect(BUDGET_CRITICAL_PCT).toBe(1.0);
  });
});

describe('startOfPeriod', () => {
  it('weekly snaps to Monday UTC', () => {
    // 2026-04-22 is a Wednesday.
    const now = new Date('2026-04-22T10:00:00Z');
    const start = startOfPeriod(now, 'weekly');
    expect(start.toISOString()).toBe('2026-04-20T00:00:00.000Z');
  });
  it('monthly snaps to 1st', () => {
    const start = startOfPeriod(new Date('2026-04-22T10:00:00Z'), 'monthly');
    expect(start.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });
  it('yearly snaps to Jan 1', () => {
    const start = startOfPeriod(new Date('2026-04-22T10:00:00Z'), 'yearly');
    expect(start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
  it('handles Sunday correctly (ISO week starts Monday)', () => {
    // 2026-04-19 is Sunday.
    const start = startOfPeriod(new Date('2026-04-19T10:00:00Z'), 'weekly');
    expect(start.toISOString()).toBe('2026-04-13T00:00:00.000Z');
  });
});

describe('detectBudgetOverThreshold', () => {
  const now = new Date('2026-04-22T10:00:00Z');

  it('no alerts when spend is below 80%', () => {
    const out = detectBudgetOverThreshold({
      householdId: HOUSEHOLD,
      budgets: [budget({ amount_cents: 500_00 })],
      transactions: [tx({ amount_cents: -100_00 })],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('emits warn at 80%', () => {
    const out = detectBudgetOverThreshold({
      householdId: HOUSEHOLD,
      budgets: [budget({ amount_cents: 500_00 })],
      transactions: [tx({ amount_cents: -400_00 })],
      now,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe('warn');
    expect(out[0]!.kind).toBe('budget_over_threshold');
    expect(out[0]!.dedupeKey).toBe('b-1:2026-04-01');
    expect(out[0]!.context.budget_id).toBe('b-1');
  });

  it('emits critical at 100%', () => {
    const out = detectBudgetOverThreshold({
      householdId: HOUSEHOLD,
      budgets: [budget({ amount_cents: 500_00 })],
      transactions: [tx({ amount_cents: -500_00 })],
      now,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe('critical');
  });

  it('critical supersedes warn — only one emission per budget at once', () => {
    const out = detectBudgetOverThreshold({
      householdId: HOUSEHOLD,
      budgets: [budget({ amount_cents: 500_00 })],
      transactions: [tx({ amount_cents: -600_00 })],
      now,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe('critical');
  });

  it('ignores income (positive amounts)', () => {
    const out = detectBudgetOverThreshold({
      householdId: HOUSEHOLD,
      budgets: [budget({ amount_cents: 500_00 })],
      transactions: [tx({ amount_cents: 400_00 })],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('ignores transactions from prior period', () => {
    const out = detectBudgetOverThreshold({
      householdId: HOUSEHOLD,
      budgets: [budget({ amount_cents: 500_00, period: 'monthly' })],
      transactions: [tx({ amount_cents: -500_00, occurred_at: '2026-03-15T00:00:00Z' })],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('matches budget category case-insensitively', () => {
    const out = detectBudgetOverThreshold({
      householdId: HOUSEHOLD,
      budgets: [budget({ category: 'Groceries' })],
      transactions: [tx({ category: 'groceries', amount_cents: -500_00 })],
      now,
    });
    expect(out).toHaveLength(1);
  });

  it('ignores non-matching categories', () => {
    const out = detectBudgetOverThreshold({
      householdId: HOUSEHOLD,
      budgets: [budget({ category: 'Groceries' })],
      transactions: [tx({ category: 'Dining', amount_cents: -500_00 })],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('skips budgets with amount_cents <= 0', () => {
    const out = detectBudgetOverThreshold({
      householdId: HOUSEHOLD,
      budgets: [budget({ amount_cents: 0 })],
      transactions: [tx({ amount_cents: -100_00 })],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('ignores other households', () => {
    const out = detectBudgetOverThreshold({
      householdId: HOUSEHOLD,
      budgets: [budget({ amount_cents: 500_00 })],
      transactions: [tx({ household_id: 'other', amount_cents: -500_00 })],
      now,
    });
    expect(out).toHaveLength(0);
  });
});
