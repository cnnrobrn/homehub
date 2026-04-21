/**
 * Shared types for `@homehub/summaries`.
 *
 * Summaries are rendered deterministically in TypeScript; no LLM calls
 * are made in M5-B. The spec's "model" stamp on `app.summary.model`
 * becomes `deterministic` for rows written by this renderer.
 *
 * The renderer output carries both a markdown body (what the UI shows)
 * and a structured `metrics` blob (what the alerts worker / graph
 * browser / follow-up summaries can consume without re-parsing the
 * markdown). Keep metrics keys stable — callers persist + query them.
 */

import { type HouseholdId } from '@homehub/shared';

export type SummaryPeriod = 'daily' | 'weekly' | 'monthly';

/** Subset of `app.transaction.Row` summaries consume. */
export interface TransactionRow {
  id: string;
  household_id: string;
  account_id: string | null;
  occurred_at: string;
  amount_cents: number;
  currency: string;
  merchant_raw: string | null;
  category: string | null;
  source: string;
  metadata: Record<string, unknown>;
}

/** Subset of `app.account.Row`. */
export interface AccountRow {
  id: string;
  household_id: string;
  name: string;
  kind: string;
  balance_cents: number | null;
  currency: string;
  last_synced_at: string | null;
}

/** Subset of `app.budget.Row`. */
export interface BudgetRow {
  id: string;
  household_id: string;
  name: string;
  category: string;
  period: 'weekly' | 'monthly' | 'yearly';
  amount_cents: number;
  currency: string;
}

export interface FinancialSummaryInput {
  householdId: HouseholdId;
  period: SummaryPeriod;
  /** Period start (inclusive) ISO. */
  coveredStart: string;
  /** Period end (exclusive) ISO. */
  coveredEnd: string;
  transactions: TransactionRow[];
  accounts: AccountRow[];
  budgets: BudgetRow[];
  /** Prior period absolute outflow, cents. Used for the "vs last period" delta. */
  priorPeriodSpendCents: number;
  /** Optional "now" for deterministic timestamps in tests. */
  now?: Date;
}

export interface FinancialSummaryMetrics {
  totalSpendCents: number;
  totalIncomeCents: number;
  biggestCategory: { category: string; spendCents: number } | null;
  biggestTransaction: { id: string; merchant: string; amountCents: number } | null;
  accountHealth: Array<{
    accountName: string;
    balanceCents: number | null;
    staleDays: number;
  }>;
  vsPriorPeriodPct: number;
  /**
   * For each budget, a `{ budgetId, category, amountCents, spentCents, pct }`
   * summary so the UI can render without a second pass over transactions.
   */
  budgetProgress: Array<{
    budgetId: string;
    category: string;
    amountCents: number;
    spentCents: number;
    pct: number;
  }>;
}

export interface FinancialSummaryOutput {
  bodyMd: string;
  metrics: FinancialSummaryMetrics;
}
