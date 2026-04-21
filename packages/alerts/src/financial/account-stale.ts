/**
 * `account_stale` detector.
 *
 * Spec: `specs/06-segments/financial/summaries-alerts.md` — "No sync in
 * 48h". The dispatch brief specifies 24h; we follow the brief because
 * the spec's 48h was the initial open-question posture and the operator
 * signal value at 24h is strictly higher. Revisit if noise becomes a
 * problem.
 *
 * Algorithm: any `app.account` row with `last_synced_at < now() - 24h`
 * (or `null`) emits `warn`. Dedupe key: `${accountId}`.
 */

import { type AccountRow, type AlertEmission } from '../types.js';

export const ACCOUNT_STALE_THRESHOLD_HOURS = 24;

export interface AccountStaleInput {
  householdId: string;
  accounts: AccountRow[];
  now: Date;
}

export function detectAccountStale(input: AccountStaleInput): AlertEmission[] {
  const thresholdMs = ACCOUNT_STALE_THRESHOLD_HOURS * 60 * 60 * 1000;
  const cutoff = input.now.getTime() - thresholdMs;
  const out: AlertEmission[] = [];
  for (const account of input.accounts) {
    if (account.household_id !== input.householdId) continue;
    const lastSyncedMs = account.last_synced_at
      ? new Date(account.last_synced_at).getTime()
      : Number.NaN;
    const stale = !Number.isFinite(lastSyncedMs) || lastSyncedMs < cutoff;
    if (!stale) continue;
    out.push({
      segment: 'financial',
      severity: 'warn',
      kind: 'account_stale',
      dedupeKey: account.id,
      title: `Account sync stale: ${account.name}`,
      body: `${account.name} has not synced in over ${ACCOUNT_STALE_THRESHOLD_HOURS} hours.`,
      context: {
        account_id: account.id,
        account_name: account.name,
        last_synced_at: account.last_synced_at,
        stale_threshold_hours: ACCOUNT_STALE_THRESHOLD_HOURS,
      },
    });
  }
  return out;
}
