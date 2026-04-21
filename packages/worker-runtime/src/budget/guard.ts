/**
 * Per-household model-budget guard.
 *
 * Reads `app.household.settings->model_budget_monthly_cents` and sums
 * the current-month `app.model_calls.cost_usd`; when usage exceeds the
 * budget, callers are told to drop non-essential jobs or switch to a
 * cheaper model.
 *
 * Neither `app.household.settings` nor `app.model_calls` exists yet —
 * both land in M1. Until then the guard returns a permissive
 * `{ ok: true, tier: 'default' }` and logs a one-time warning so call
 * sites can wire it today.
 *
 * Spec: `specs/05-agents/model-routing.md` § Per-household budgets.
 */

import { type HouseholdId } from '@homehub/shared';

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

let stubWarned = false;

export async function withBudgetGuard(
  supabase: ServiceSupabaseClient,
  args: WithBudgetGuardArgs,
  logger?: Logger,
): Promise<BudgetCheckResult> {
  void supabase;
  void args;
  if (!stubWarned) {
    logger?.warn(
      'withBudgetGuard: app.model_calls / household.settings not yet provisioned; returning default tier',
    );
    stubWarned = true;
  }
  return { ok: true, tier: 'default' };
}

/**
 * Test-only reset so the warning can be reasserted independently per
 * test. Not exported from the barrel.
 * @internal
 */
export function __resetBudgetGuardForTests(): void {
  stubWarned = false;
}
