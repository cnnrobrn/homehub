/**
 * `payment_failed` detector.
 *
 * Spec: `specs/06-segments/financial/summaries-alerts.md`.
 *
 * Heuristic:
 *   - A transaction's `metadata.payment_failed === true` (explicit flag
 *     from the YNAB provider or email receipt parser) is always a match.
 *   - Otherwise, text search on `memo` OR `merchant_raw` for
 *     `/\b(failed|declined|returned)\b/i`.
 *
 * Only rows in the last 7 days are considered so old DLQ'd failures
 * don't re-alert forever. Severity is always `critical` — a missed
 * autopay is the classic "demands action" case.
 *
 * Dedupe key: `${transactionId}`. If the same row is seen twice we still
 * only produce one alert within the worker's 24h dedupe window.
 */

import { type TransactionRow, type AlertEmission } from '../types.js';

export const PAYMENT_FAILED_LOOKBACK_DAYS = 7;
const PAYMENT_FAILED_RE = /\b(failed|declined|returned)\b/i;

export interface PaymentFailedInput {
  householdId: string;
  transactions: TransactionRow[];
  now: Date;
}

export function detectPaymentFailed(input: PaymentFailedInput): AlertEmission[] {
  const cutoff = input.now.getTime() - PAYMENT_FAILED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const out: AlertEmission[] = [];
  for (const tx of input.transactions) {
    if (tx.household_id !== input.householdId) continue;
    const ts = new Date(tx.occurred_at).getTime();
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    if (!isPaymentFailure(tx)) continue;
    out.push({
      segment: 'financial',
      severity: 'critical',
      kind: 'payment_failed',
      dedupeKey: tx.id,
      title: `Payment failed${tx.merchant_raw ? ` at ${tx.merchant_raw}` : ''}`,
      body: `A payment${tx.merchant_raw ? ` at ${tx.merchant_raw}` : ''} of ${formatCents(Math.abs(tx.amount_cents))} appears to have failed or been declined.`,
      context: {
        transaction_id: tx.id,
        account_id: tx.account_id,
        merchant_raw: tx.merchant_raw,
        amount_cents: tx.amount_cents,
        occurred_at: tx.occurred_at,
      },
    });
  }
  return out;
}

function isPaymentFailure(tx: TransactionRow): boolean {
  const meta = tx.metadata ?? {};
  if (typeof meta === 'object' && meta !== null) {
    const flag = (meta as Record<string, unknown>).payment_failed;
    if (flag === true) return true;
  }
  const haystack = `${tx.memo ?? ''} ${tx.merchant_raw ?? ''}`;
  return PAYMENT_FAILED_RE.test(haystack);
}

function formatCents(n: number): string {
  return `$${(n / 100).toFixed(2)}`;
}
