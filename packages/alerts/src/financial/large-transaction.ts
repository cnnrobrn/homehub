/**
 * `large_transaction` detector.
 *
 * Spec: `specs/06-segments/financial/summaries-alerts.md` — "Amount >
 * household threshold (default $500)".
 *
 * Algorithm: emit `info` for any transaction in the last 7 days whose
 * absolute `amount_cents` exceeds the household's configured threshold
 * (`household.settings.financial.large_transaction_threshold_cents`,
 * default $500 via `DEFAULT_HOUSEHOLD_ALERT_SETTINGS`).
 *
 * Dedupe key: `${transactionId}`.
 */

import {
  DEFAULT_HOUSEHOLD_ALERT_SETTINGS,
  type AlertEmission,
  type HouseholdAlertSettings,
  type TransactionRow,
} from '../types.js';

export const LARGE_TRANSACTION_LOOKBACK_DAYS = 7;

export interface LargeTransactionInput {
  householdId: string;
  transactions: TransactionRow[];
  settings?: HouseholdAlertSettings;
  now: Date;
}

export function detectLargeTransaction(input: LargeTransactionInput): AlertEmission[] {
  const settings = input.settings ?? DEFAULT_HOUSEHOLD_ALERT_SETTINGS;
  const threshold = settings.largeTransactionThresholdCents;
  const cutoff = input.now.getTime() - LARGE_TRANSACTION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const out: AlertEmission[] = [];
  for (const tx of input.transactions) {
    if (tx.household_id !== input.householdId) continue;
    const ts = new Date(tx.occurred_at).getTime();
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    if (Math.abs(tx.amount_cents) <= threshold) continue;
    out.push({
      segment: 'financial',
      severity: 'info',
      kind: 'large_transaction',
      dedupeKey: tx.id,
      title: `Large transaction: ${formatCents(Math.abs(tx.amount_cents))}${tx.merchant_raw ? ` at ${tx.merchant_raw}` : ''}`,
      body: `A ${formatCents(Math.abs(tx.amount_cents))} transaction${tx.merchant_raw ? ` at ${tx.merchant_raw}` : ''} crossed the household's ${formatCents(threshold)} threshold.`,
      context: {
        transaction_id: tx.id,
        account_id: tx.account_id,
        merchant_raw: tx.merchant_raw,
        amount_cents: tx.amount_cents,
        occurred_at: tx.occurred_at,
        threshold_cents: threshold,
      },
    });
  }
  return out;
}

function formatCents(n: number): string {
  return `$${(n / 100).toFixed(2)}`;
}
