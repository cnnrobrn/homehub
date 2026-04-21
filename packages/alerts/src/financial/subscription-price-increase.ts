/**
 * `subscription_price_increase` detector.
 *
 * Spec: `specs/06-segments/financial/summaries-alerts.md`.
 *
 * Given a subscription `mem.node` and its charge history, compare the
 * most recent charge's absolute amount to the median of the prior
 * charges. If it's ≥ 5% higher AND the prior median is positive, emit
 * a `warn`.
 *
 * (The spec copy says "> 10%" in the tabular summary but the dispatch
 * brief says "≥ 5%" — we follow the brief; 5% catches e.g. a $9.99 →
 * $10.49 bump that $10% would miss.)
 *
 * Dedupe key: `${subscriptionNodeId}:${latestChargeMonth}`. If the next
 * month's charge is still higher, a new alert fires with a fresh key.
 */

import { type SubscriptionNode, type TransactionRow, type AlertEmission } from '../types.js';

export const PRICE_INCREASE_THRESHOLD_PCT = 0.05;

export interface SubscriptionPriceInput {
  householdId: string;
  subscriptions: SubscriptionNode[];
  /**
   * Transactions that carry a subscription pointer in their metadata —
   * `metadata.recurring_signal` (the subscription node id). The
   * subscription detector writes that pointer; we read it here.
   */
  transactions: TransactionRow[];
  now: Date;
}

export function detectSubscriptionPriceIncrease(input: SubscriptionPriceInput): AlertEmission[] {
  const out: AlertEmission[] = [];
  for (const sub of input.subscriptions) {
    if (sub.household_id !== input.householdId) continue;
    const charges = input.transactions
      .filter((tx) => tx.household_id === input.householdId)
      .filter((tx) => readRecurringSignal(tx.metadata) === sub.id)
      .slice()
      .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
    if (charges.length < 2) continue;

    const [latest, ...rest] = charges;
    if (!latest) continue;
    const latestAbs = Math.abs(latest.amount_cents);
    const priorAmounts = rest.map((c) => Math.abs(c.amount_cents));
    const priorMedian = median(priorAmounts);
    if (priorMedian <= 0) continue;

    const pct = (latestAbs - priorMedian) / priorMedian;
    if (pct < PRICE_INCREASE_THRESHOLD_PCT) continue;

    const chargeMonth = latest.occurred_at.slice(0, 7); // YYYY-MM
    out.push({
      segment: 'financial',
      severity: 'warn',
      kind: 'subscription_price_increase',
      dedupeKey: `${sub.id}:${chargeMonth}`,
      title: `${sub.canonical_name} price increase`,
      body: `${sub.canonical_name} charged ${formatCents(latestAbs)} this period, up ${Math.round(pct * 100)}% from a prior median of ${formatCents(priorMedian)}.`,
      context: {
        subscription_node_id: sub.id,
        transaction_id: latest.id,
        latest_amount_cents: latestAbs,
        prior_median_cents: priorMedian,
        increase_pct: pct,
        occurred_at: latest.occurred_at,
      },
    });
  }
  return out;
}

function readRecurringSignal(metadata: Record<string, unknown>): string | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const raw = (metadata as Record<string, unknown>).recurring_signal;
  return typeof raw === 'string' ? raw : undefined;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function formatCents(n: number): string {
  return `$${(n / 100).toFixed(2)}`;
}
