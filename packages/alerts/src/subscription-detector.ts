/**
 * Subscription detector.
 *
 * Spec: `specs/06-segments/financial/summaries-alerts.md` +
 * `specs/04-memory-network/graph-schema.md` (mem.node type
 * `subscription`).
 *
 * Pure function: given a household's last-90d transactions, returns a
 * list of subscription *candidates*. The caller (`apps/workers/alerts`)
 * decides whether to upsert each candidate into `mem.node` + re-tag the
 * matched transactions' `metadata.recurring_signal`.
 *
 * Detection rules:
 *   - Group transactions by normalized merchant.
 *   - Require ≥ 3 charges.
 *   - All amounts within ±5% of the group median.
 *   - Cadence:
 *       - weekly:  median inter-charge gap in [7±1] days (inclusive).
 *       - monthly: median inter-charge gap in [30±3] days.
 *       - yearly:  median inter-charge gap in [365±7] days.
 *     Anything else is not considered a subscription.
 *
 * Output per candidate:
 *   - canonical_name (merchant raw, trimmed; case preserved from the
 *     first-seen row so downstream display looks natural).
 *   - cadence, price_cents (median of the group), currency.
 *   - matchedTransactionIds — every tx in the group.
 */

import { type TransactionRow } from './types.js';

export const SUBSCRIPTION_MIN_CHARGES = 3;
export const SUBSCRIPTION_AMOUNT_TOLERANCE_PCT = 0.05;

export type SubscriptionCadence = 'weekly' | 'monthly' | 'yearly';

export interface SubscriptionCandidate {
  canonicalName: string;
  cadence: SubscriptionCadence;
  priceCents: number;
  currency: string;
  matchedTransactionIds: string[];
}

export interface DetectSubscriptionsInput {
  householdId: string;
  transactions: TransactionRow[];
  now: Date;
}

export const SUBSCRIPTION_LOOKBACK_DAYS = 90;

export function detectSubscriptions(input: DetectSubscriptionsInput): SubscriptionCandidate[] {
  const cutoff = input.now.getTime() - SUBSCRIPTION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  const byMerchant = new Map<string, TransactionRow[]>();
  for (const tx of input.transactions) {
    if (tx.household_id !== input.householdId) continue;
    const ts = new Date(tx.occurred_at).getTime();
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    // Only outflows look like subscriptions.
    if (tx.amount_cents >= 0) continue;
    const key = normalizeMerchant(tx.merchant_raw);
    if (!key) continue;
    const arr = byMerchant.get(key) ?? [];
    arr.push(tx);
    byMerchant.set(key, arr);
  }

  const out: SubscriptionCandidate[] = [];
  for (const [, rows] of byMerchant) {
    if (rows.length < SUBSCRIPTION_MIN_CHARGES) continue;
    const sorted = rows
      .slice()
      .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());

    const amounts = sorted.map((t) => Math.abs(t.amount_cents));
    const med = median(amounts);
    if (med <= 0) continue;
    const amountsOk = amounts.every(
      (a) => Math.abs(a - med) / med <= SUBSCRIPTION_AMOUNT_TOLERANCE_PCT,
    );
    if (!amountsOk) continue;

    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i += 1) {
      const a = new Date(sorted[i - 1]!.occurred_at).getTime();
      const b = new Date(sorted[i]!.occurred_at).getTime();
      gaps.push((b - a) / (24 * 60 * 60 * 1000));
    }
    const medGap = median(gaps);
    const cadence = classifyCadence(medGap);
    if (!cadence) continue;

    const first = sorted[0]!;
    out.push({
      canonicalName: (first.merchant_raw ?? '').trim() || fallbackName(first.merchant_raw),
      cadence,
      priceCents: Math.round(med),
      currency: first.currency,
      matchedTransactionIds: sorted.map((t) => t.id),
    });
  }
  return out;
}

export function classifyCadence(medianGapDays: number): SubscriptionCadence | null {
  if (medianGapDays >= 6 && medianGapDays <= 8) return 'weekly';
  if (medianGapDays >= 27 && medianGapDays <= 33) return 'monthly';
  if (medianGapDays >= 358 && medianGapDays <= 372) return 'yearly';
  return null;
}

function normalizeMerchant(raw: string | null): string {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fallbackName(raw: string | null): string {
  return raw ?? 'Unknown merchant';
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
