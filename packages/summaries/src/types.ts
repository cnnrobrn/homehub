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

// ---- Food summary ---------------------------------------------------------

/** Subset of `app.meal.Row` food summaries consume. */
export interface MealSummaryRow {
  id: string;
  household_id: string;
  /** ISO date (YYYY-MM-DD). */
  planned_for: string;
  slot: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  title: string;
  dish_node_id: string | null;
  cook_member_id: string | null;
  status: 'planned' | 'cooking' | 'served' | 'skipped';
}

/** Subset of `app.pantry_item.Row`. */
export interface PantryItemSummaryRow {
  id: string;
  household_id: string;
  name: string;
  /** ISO date (YYYY-MM-DD) or null. */
  expires_on: string | null;
}

export interface FoodSummaryInput {
  householdId: HouseholdId;
  period: SummaryPeriod;
  /** Period start (inclusive) ISO. */
  coveredStart: string;
  /** Period end (exclusive) ISO. */
  coveredEnd: string;
  meals: MealSummaryRow[];
  pantryItems: PantryItemSummaryRow[];
  /** Member display names keyed by `app.member.id`. */
  memberNamesById: Map<string, string>;
  /** Optional "now" for deterministic timestamps in tests. */
  now?: Date;
}

export interface FoodSummaryMetrics {
  mealCount: number;
  /** Unique dishes (by dish_node_id if present, else normalized title). */
  dishVariety: number;
  /** Variety ratio in [0, 1]: dishVariety / mealCount. */
  dishVarietyRatio: number;
  /** Count of pantry items whose `expires_on` landed in-period. */
  pantryItemsExpired: number;
  cookingByMember: Array<{
    memberId: string | null;
    memberName: string;
    mealCount: number;
  }>;
}

export interface FoodSummaryOutput {
  bodyMd: string;
  metrics: FoodSummaryMetrics;
}

// ---- Social summary -------------------------------------------------------

export interface SocialEpisodeRow {
  id: string;
  household_id: string;
  occurred_at: string;
  participants: string[];
  place_node_id: string | null;
  source_type: string;
  metadata: Record<string, unknown>;
}

export interface SocialPersonRow {
  id: string;
  household_id: string;
  canonical_name: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface SocialEventRow {
  id: string;
  household_id: string;
  kind: string;
  title: string;
  starts_at: string;
  metadata: Record<string, unknown>;
}

export interface SocialAbsentPerson {
  id: string;
  household_id: string;
  canonical_name: string;
  lastSeenAt: string | null;
}

export interface SocialSummaryInput {
  householdId: HouseholdId;
  period: SummaryPeriod;
  coveredStart: string;
  coveredEnd: string;
  episodes: SocialEpisodeRow[];
  people: SocialPersonRow[];
  /**
   * Upcoming social-segment events (birthdays, anniversaries) the
   * summary reports in the "coming up" section. The caller passes the
   * next 30 days of rows sourced from `app.event`.
   */
  upcomingEvents: SocialEventRow[];
  /**
   * Persons flagged by the alerts worker as in a long absence. The
   * social summary surfaces these as "noticed gaps"; it does not
   * recompute absence.
   */
  absentPersons: SocialAbsentPerson[];
  /** `personNodeId -> canonical_name` lookup used to label top people. */
  personNames: Map<string, string>;
  now?: Date;
}

export interface SocialSummaryMetrics {
  uniquePeopleCount: number;
  topPeople: Array<{ personNodeId: string; canonicalName: string; episodeCount: number }>;
  newPeople: Array<{ personNodeId: string; canonicalName: string }>;
  upcomingEvents: Array<{ eventId: string; kind: string; title: string; startsAt: string }>;
  absentPersons: Array<{ personNodeId: string; canonicalName: string; lastSeenAt: string | null }>;
}

export interface SocialSummaryOutput {
  bodyMd: string;
  metrics: SocialSummaryMetrics;
}
