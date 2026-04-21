/**
 * Per-household model-budget guard.
 *
 * Sums the current calendar-month `app.model_calls.cost_usd` for a
 * household and compares it against
 * `app.household.settings->>'model_budget_monthly_cents'`. Returns:
 *
 *   - `{ ok: true, tier: 'default' }`   — usage < 80% of budget, or no
 *                                         budget configured (Infinity).
 *   - `{ ok: true, tier: 'degraded' }`  — usage >= 80% of budget; caller
 *                                         should prefer cheaper models.
 *   - `{ ok: false, reason: 'budget_exceeded' }` — usage >= 100% of
 *                                         budget; caller should drop
 *                                         non-essential jobs.
 *
 * The DB-side store is cost in USD (numeric) on `model_calls.cost_usd`;
 * the budget ceiling is stored in *cents* on household.settings so a
 * small integer lives in JSONB without rounding drift. We convert on
 * read.
 *
 * Spec: `specs/05-agents/model-routing.md` § Per-household budgets.
 */

import { type HouseholdId } from '@homehub/shared';
import { z } from 'zod';

import { type Logger } from '../log/logger.js';
import { type ServiceSupabaseClient } from '../supabase/client.js';

export type BudgetTier = 'default' | 'degraded';

export type BudgetCheckResult =
  | { ok: true; tier: BudgetTier }
  | { ok: false; reason: 'budget_exceeded' };

export interface WithBudgetGuardArgs {
  household_id: HouseholdId;
  /** e.g. `'enrichment.event'`, `'summary.weekly'`. */
  task_class: string;
}

/**
 * Shape we expect under `household.settings`. We parse defensively —
 * settings is `jsonb`, callers can add arbitrary keys, and we only need
 * one field. Non-numeric values fall back to "unlimited."
 */
const householdSettingsSchema = z
  .object({
    model_budget_monthly_cents: z.number().nonnegative().optional(),
  })
  .catchall(z.unknown());

/**
 * Compute the first-of-month UTC timestamp for the supplied `now`. We
 * use UTC so "budget month" is a stable boundary across zones. The
 * alternative — household-local time — adds complexity for the sake of
 * one edge-of-day case; the spec explicitly names monthly budgets.
 */
function firstOfMonthUtc(now: Date): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)).toISOString();
}

export async function withBudgetGuard(
  supabase: ServiceSupabaseClient,
  args: WithBudgetGuardArgs,
  logger?: Logger,
): Promise<BudgetCheckResult> {
  // 1) Pull the budget from household.settings. service_role bypasses RLS.
  const { data: hRow, error: hErr } = await supabase
    .schema('app')
    .from('household')
    .select('settings')
    .eq('id', args.household_id)
    .maybeSingle();

  if (hErr) {
    logger?.warn('withBudgetGuard: household read failed', { error: hErr.message });
    // Fail open: instrumentation must not block jobs. Caller still gets
    // a permissive answer and the warn is operator-observable.
    return { ok: true, tier: 'default' };
  }

  const settings = householdSettingsSchema.safeParse(hRow?.settings ?? {});
  const budgetCents = settings.success ? settings.data.model_budget_monthly_cents : undefined;
  if (budgetCents === undefined) {
    // No budget configured — permissive.
    return { ok: true, tier: 'default' };
  }

  // 2) Sum current-month cost.
  const periodStart = firstOfMonthUtc(new Date());
  const { data: rows, error: cErr } = await supabase
    .schema('app')
    .from('model_calls')
    .select('cost_usd')
    .eq('household_id', args.household_id)
    .gte('at', periodStart);

  if (cErr) {
    logger?.warn('withBudgetGuard: model_calls read failed', { error: cErr.message });
    return { ok: true, tier: 'default' };
  }

  const usedUsd = (rows ?? []).reduce((acc, r) => {
    const n = typeof r.cost_usd === 'number' ? r.cost_usd : Number(r.cost_usd);
    return Number.isFinite(n) ? acc + n : acc;
  }, 0);
  const usedCents = Math.round(usedUsd * 100);

  if (usedCents >= budgetCents) {
    return { ok: false, reason: 'budget_exceeded' };
  }
  if (usedCents >= Math.floor(budgetCents * 0.8)) {
    return { ok: true, tier: 'degraded' };
  }
  return { ok: true, tier: 'default' };
}
