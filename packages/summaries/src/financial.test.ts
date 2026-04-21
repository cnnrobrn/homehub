/**
 * Unit tests for the financial summary renderer.
 *
 * Fixture-style coverage across:
 *   - Empty household (no transactions) → "no activity" message.
 *   - Weekly with a handful of transactions (happy path).
 *   - Monthly with multi-category breakdown + budget progress.
 *   - Account staleness accounting (null, recent, old, never).
 *   - Prior-period comparison edge cases.
 */

import { describe, expect, it } from 'vitest';

import { renderFinancialSummary } from './financial.js';
import {
  type AccountRow,
  type BudgetRow,
  type FinancialSummaryInput,
  type TransactionRow,
} from './types.js';

const HOUSEHOLD = 'h-1';

function tx(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: 't-1',
    household_id: HOUSEHOLD,
    account_id: 'a-1',
    occurred_at: '2026-04-15T00:00:00Z',
    amount_cents: -25_00,
    currency: 'USD',
    merchant_raw: 'Trader Joe',
    category: 'Groceries',
    source: 'ynab',
    metadata: {},
    ...overrides,
  };
}

function account(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'a-1',
    household_id: HOUSEHOLD,
    name: 'Checking',
    kind: 'checking',
    balance_cents: 5000_00,
    currency: 'USD',
    last_synced_at: '2026-04-22T00:00:00Z',
    ...overrides,
  };
}

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

function baseInput(overrides: Partial<FinancialSummaryInput> = {}): FinancialSummaryInput {
  return {
    householdId: HOUSEHOLD as never,
    period: 'weekly',
    coveredStart: '2026-04-13T00:00:00Z',
    coveredEnd: '2026-04-20T00:00:00Z',
    transactions: [],
    accounts: [],
    budgets: [],
    priorPeriodSpendCents: 0,
    now: new Date('2026-04-22T00:00:00Z'),
    ...overrides,
  };
}

describe('renderFinancialSummary', () => {
  it('empty household: no-activity message', () => {
    const result = renderFinancialSummary(baseInput());
    expect(result.bodyMd).toContain('No financial activity');
    expect(result.metrics.totalSpendCents).toBe(0);
    expect(result.metrics.biggestCategory).toBeNull();
    expect(result.metrics.biggestTransaction).toBeNull();
  });

  it('weekly happy path: spend, income, biggest category + transaction', () => {
    const result = renderFinancialSummary(
      baseInput({
        transactions: [
          tx({ id: 't-1', amount_cents: -50_00, category: 'Groceries' }),
          tx({ id: 't-2', amount_cents: -100_00, category: 'Dining', merchant_raw: 'Chez Henri' }),
          tx({ id: 't-3', amount_cents: -25_00, category: 'Groceries' }),
          tx({ id: 't-4', amount_cents: 2000_00, category: 'Income', merchant_raw: 'Acme' }),
        ],
        accounts: [account()],
        priorPeriodSpendCents: 100_00,
      }),
    );
    expect(result.metrics.totalSpendCents).toBe(175_00);
    expect(result.metrics.totalIncomeCents).toBe(2000_00);
    expect(result.metrics.biggestCategory).toEqual({ category: 'Dining', spendCents: 100_00 });
    expect(result.metrics.biggestTransaction?.id).toBe('t-2');
    expect(result.metrics.biggestTransaction?.amountCents).toBe(-100_00);
    // +75% vs $100.00 prior period
    expect(result.metrics.vsPriorPeriodPct).toBeCloseTo(0.75, 5);
    expect(result.bodyMd).toContain('Weekly financial brief');
    expect(result.bodyMd).toContain('$175.00');
    expect(result.bodyMd).toContain('up 75%');
    expect(result.bodyMd).toContain('Chez Henri');
  });

  it('monthly with budget progress: over / near / on pace', () => {
    const result = renderFinancialSummary(
      baseInput({
        period: 'monthly',
        coveredStart: '2026-04-01T00:00:00Z',
        coveredEnd: '2026-05-01T00:00:00Z',
        transactions: [
          tx({ id: 't-1', amount_cents: -600_00, category: 'Groceries' }), // over
          tx({ id: 't-2', amount_cents: -250_00, category: 'Dining' }), // near (83%)
          tx({ id: 't-3', amount_cents: -20_00, category: 'Shopping' }),
        ],
        budgets: [
          budget({ id: 'b-1', category: 'Groceries', amount_cents: 500_00 }),
          budget({ id: 'b-2', category: 'Dining', amount_cents: 300_00 }),
          budget({ id: 'b-3', category: 'Shopping', amount_cents: 200_00 }),
        ],
        priorPeriodSpendCents: 1000_00,
      }),
    );
    expect(result.metrics.budgetProgress).toHaveLength(3);
    const groceries = result.metrics.budgetProgress.find((b) => b.budgetId === 'b-1');
    expect(groceries?.pct).toBeCloseTo(1.2, 5);
    expect(result.bodyMd).toContain('Monthly financial brief');
    expect(result.bodyMd).toContain('over');
    expect(result.bodyMd).toContain('near');
    expect(result.bodyMd).toContain('on pace');
    expect(result.bodyMd).toContain('down 13%');
  });

  it('account health includes stale days', () => {
    const result = renderFinancialSummary(
      baseInput({
        accounts: [
          account({ id: 'a-1', name: 'Fresh', last_synced_at: '2026-04-22T00:00:00Z' }),
          account({ id: 'a-2', name: 'Stale', last_synced_at: '2026-04-10T00:00:00Z' }),
          account({ id: 'a-3', name: 'Never', last_synced_at: null }),
        ],
        transactions: [tx({ amount_cents: -10_00 })],
      }),
    );
    expect(result.metrics.accountHealth).toHaveLength(3);
    expect(result.metrics.accountHealth[0]!.staleDays).toBe(0);
    expect(result.metrics.accountHealth[1]!.staleDays).toBe(12);
    expect(result.metrics.accountHealth[2]!.staleDays).toBe(Number.POSITIVE_INFINITY);
    expect(result.bodyMd).toContain('Fresh');
    expect(result.bodyMd).toContain('12d since sync');
    expect(result.bodyMd).toContain('never synced');
  });

  it('ignores other households', () => {
    const result = renderFinancialSummary(
      baseInput({
        transactions: [tx({ household_id: 'other', amount_cents: -100_00 })],
        accounts: [account({ household_id: 'other' })],
        budgets: [budget({ household_id: 'other' })],
      }),
    );
    expect(result.metrics.totalSpendCents).toBe(0);
    expect(result.metrics.accountHealth).toHaveLength(0);
    expect(result.metrics.budgetProgress).toHaveLength(0);
  });

  it('skips vs-prior-period when prior is 0', () => {
    const result = renderFinancialSummary(
      baseInput({
        transactions: [tx({ amount_cents: -50_00 })],
        priorPeriodSpendCents: 0,
      }),
    );
    expect(result.metrics.vsPriorPeriodPct).toBe(0);
    expect(result.bodyMd).not.toContain('vs last period');
  });

  it('uncategorized rows roll up into an "Uncategorized" bucket', () => {
    const result = renderFinancialSummary(
      baseInput({
        transactions: [
          tx({ id: 't-1', amount_cents: -30_00, category: null }),
          tx({ id: 't-2', amount_cents: -40_00, category: null }),
        ],
      }),
    );
    expect(result.metrics.biggestCategory).toEqual({
      category: 'Uncategorized',
      spendCents: 70_00,
    });
  });
});
