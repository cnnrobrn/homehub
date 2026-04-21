/**
 * Shared types for `@homehub/alerts`.
 *
 * The detectors are pure functions. Each returns zero or more
 * `AlertEmission` records; the alerts worker turns those into `app.alert`
 * rows with RLS-safe inserts, deduping on `(household_id, kind, dedupeKey)`
 * within a 24h window.
 *
 * `kind` is the stable detector identifier (e.g. `budget_over_threshold`).
 * `dedupeKey` is a detector-specific string that makes re-runs produce
 * the same key — the worker turns the pair into a `context.dedupe_key`
 * so alerts remain passive (no schema change required today; a follow-up
 * migration adds dedicated `kind` + `dedupe_key` columns).
 *
 * `severity` matches the spec (info / warn / critical) — alerts tagged
 * `info` are summary-only, `warn` surfaces in the segment panel, `critical`
 * sits at the top of the dashboard. The UI policy is owned by
 * @frontend-chat (M5-C); detectors just pick the right level.
 *
 * `context` carries graph pointers (transaction ids, budget ids, node ids).
 * The frontend uses those to deep-link into the memory browser.
 */

import { type Segment } from '@homehub/shared';

export type AlertSeverity = 'info' | 'warn' | 'critical';

/**
 * Emission shape. Purely data; no side effects. The alerts worker
 * decides when to persist + how to dedupe.
 */
export interface AlertEmission {
  segment: Segment;
  severity: AlertSeverity;
  title: string;
  /** Short markdown body — ≤ 2 sentences. */
  body: string;
  /**
   * Pointers into the graph / data model. The UI reads this to deep-link.
   * Keep keys snake_case and values primitives + string ids for straight
   * JSON serialization.
   */
  context: Record<string, unknown>;
  /** Detector identifier, e.g. `budget_over_threshold`. */
  kind: string;
  /** Detector-specific dedupe key; identical re-runs produce identical keys. */
  dedupeKey: string;
}

/** Subset of `app.transaction.Row` the financial detectors consume. */
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
  memo?: string | null;
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

/** Subset of `mem.node.Row` for subscription-typed nodes. */
export interface SubscriptionNode {
  id: string;
  household_id: string;
  canonical_name: string;
  /** Read from `mem.node.metadata` — `{ cadence, price_cents }`. */
  metadata: Record<string, unknown>;
  /** Member-curated nodes have `needs_review=false`. */
  needs_review: boolean;
  created_at: string;
}

/** Per-household settings relevant to financial alerting. */
export interface HouseholdAlertSettings {
  /** Dollar threshold (cents) above which a single transaction alerts. */
  largeTransactionThresholdCents: number;
}

/** Default household settings when none provided. */
export const DEFAULT_HOUSEHOLD_ALERT_SETTINGS: HouseholdAlertSettings = {
  // $500 — matches `specs/06-segments/financial/summaries-alerts.md`.
  largeTransactionThresholdCents: 500_00,
};
