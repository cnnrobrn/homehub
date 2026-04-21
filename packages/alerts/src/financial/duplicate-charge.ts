/**
 * `duplicate_charge` detector.
 *
 * Spec: `specs/06-segments/financial/summaries-alerts.md` — "Two charges
 * same merchant same day within $0.01".
 *
 * Algorithm: for each pair of transactions in the same account with:
 *   - `|amount_cents_a - amount_cents_b| ≤ 1` (±$0.01)
 *   - Same merchant (case-insensitive exact match on normalized form)
 *   - Within 24h of each other
 * emit a `warn` pointing at the *later* transaction (the duplicate).
 *
 * Dedupe key: `${laterTransactionId}`.
 *
 * Note: a real "first charge refunded, second charge is legit" pattern
 * looks identical to us. The alert copy is careful to surface the pair
 * and let the member decide.
 */

import { type TransactionRow, type AlertEmission } from '../types.js';

export const DUPLICATE_AMOUNT_TOLERANCE_CENTS = 1;
export const DUPLICATE_TIME_WINDOW_HOURS = 24;

export interface DuplicateChargeInput {
  householdId: string;
  transactions: TransactionRow[];
  now: Date;
}

export function detectDuplicateCharge(input: DuplicateChargeInput): AlertEmission[] {
  const rows = input.transactions.filter((tx) => tx.household_id === input.householdId);
  const byAccount = new Map<string, TransactionRow[]>();
  for (const tx of rows) {
    if (!tx.account_id) continue;
    const arr = byAccount.get(tx.account_id) ?? [];
    arr.push(tx);
    byAccount.set(tx.account_id, arr);
  }

  const out: AlertEmission[] = [];
  const windowMs = DUPLICATE_TIME_WINDOW_HOURS * 60 * 60 * 1000;
  for (const [, txs] of byAccount) {
    const sorted = txs
      .slice()
      .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
    for (let i = 0; i < sorted.length; i += 1) {
      const a = sorted[i]!;
      const aMerchant = normalizeMerchant(a.merchant_raw);
      if (!aMerchant) continue;
      for (let j = i + 1; j < sorted.length; j += 1) {
        const b = sorted[j]!;
        const bMerchant = normalizeMerchant(b.merchant_raw);
        if (!bMerchant || aMerchant !== bMerchant) continue;
        const ta = new Date(a.occurred_at).getTime();
        const tb = new Date(b.occurred_at).getTime();
        if (!Number.isFinite(ta) || !Number.isFinite(tb)) continue;
        if (tb - ta > windowMs) break; // sorted ascending; later pairs are farther out
        if (Math.abs(a.amount_cents - b.amount_cents) > DUPLICATE_AMOUNT_TOLERANCE_CENTS) continue;
        // Emit on the later transaction.
        out.push({
          segment: 'financial',
          severity: 'warn',
          kind: 'duplicate_charge',
          dedupeKey: b.id,
          title: `Possible duplicate charge${b.merchant_raw ? ` at ${b.merchant_raw}` : ''}`,
          body: `Two charges of ${formatCents(Math.abs(b.amount_cents))} at ${b.merchant_raw ?? 'the same merchant'} within ${DUPLICATE_TIME_WINDOW_HOURS}h.`,
          context: {
            transaction_id: b.id,
            paired_transaction_id: a.id,
            account_id: b.account_id,
            merchant_raw: b.merchant_raw,
            amount_cents: b.amount_cents,
            occurred_at: b.occurred_at,
            paired_occurred_at: a.occurred_at,
          },
        });
      }
    }
  }
  return out;
}

function normalizeMerchant(raw: string | null): string {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatCents(n: number): string {
  return `$${(n / 100).toFixed(2)}`;
}
