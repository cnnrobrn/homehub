/**
 * `summaries` handler — financial weekly / monthly digest generator.
 *
 * Spec anchors:
 *   - `specs/05-agents/summaries.md` (cadence, inputs, outputs).
 *   - `specs/06-segments/financial/summaries-alerts.md` (section list).
 *
 * Cron-driven. `runSummariesWorker` is invoked by a Railway cron trigger
 * (see README + `src/main.ts`). One invocation per period:
 *   - weekly: Monday 04:00 UTC.
 *   - monthly: 1st of month, 05:00 UTC.
 *
 * Algorithm per household × period:
 *   1. Compute `coveredStart` / `coveredEnd` from the run date + period.
 *   2. Dedupe: skip if `app.summary` row exists for
 *      `(household_id, segment='financial', period, covered_start)`.
 *   3. Load transactions / accounts / budgets + prior-period spend.
 *   4. Call `renderFinancialSummary`.
 *   5. Insert `app.summary` with `model='deterministic'`.
 *   6. Audit `summary.financial.generated`.
 *
 * Empty households still get a "no activity" summary — the UI shows a
 * placeholder row rather than leaving the digest timeline bare.
 */

import { type Database, type Json } from '@homehub/db';
import { type HouseholdId } from '@homehub/shared';
import {
  renderFinancialSummary,
  renderFoodSummary,
  renderFunSummary,
  renderSocialSummary,
  type AccountRow as SummaryAccountRow,
  type BudgetRow as SummaryBudgetRow,
  type FinancialSummaryInput,
  type FinancialSummaryOutput,
  type FoodSummaryInput,
  type FoodSummaryOutput,
  type FunEventRow as SummaryFunEventRow,
  type FunSummaryInput,
  type FunSummaryOutput,
  type MealSummaryRow,
  type PantryItemSummaryRow,
  type SocialAbsentPerson,
  type SocialEpisodeRow,
  type SocialEventRow,
  type SocialPersonRow,
  type SocialSummaryInput,
  type SocialSummaryOutput,
  type SummaryPeriod,
  type TransactionRow as SummaryTransactionRow,
} from '@homehub/summaries';
import { type Logger } from '@homehub/worker-runtime';
import { type SupabaseClient } from '@supabase/supabase-js';

export const SUMMARY_MODEL_LABEL = 'deterministic';
export const SUMMARY_SEGMENT = 'financial';

export interface SummariesWorkerDeps {
  supabase: SupabaseClient<Database>;
  log: Logger;
  now?: () => Date;
  /**
   * Scope the run to a specific household set. When omitted, we iterate
   * every household with at least one `app.member` row (every active
   * household).
   */
  householdIds?: string[];
  /** Which periods to run. Defaults to `['weekly']`. */
  periods?: SummaryPeriod[];
}

export interface SummariesRunResult {
  householdId: string;
  period: SummaryPeriod;
  skipped: boolean;
  reason?: string;
  insertedId?: string;
}

export async function runSummariesWorker(deps: SummariesWorkerDeps): Promise<SummariesRunResult[]> {
  const now = (deps.now ?? (() => new Date()))();
  const periods = deps.periods ?? ['weekly'];
  const householdIds = deps.householdIds ?? (await listHouseholds(deps.supabase));
  const results: SummariesRunResult[] = [];

  for (const householdId of householdIds) {
    for (const period of periods) {
      try {
        const result = await runOneHouseholdPeriod(deps, householdId, period, now);
        results.push(result);
      } catch (err) {
        deps.log.error('summaries: household/period run failed', {
          household_id: householdId,
          period,
          error: err instanceof Error ? err.message : String(err),
        });
        results.push({
          householdId,
          period,
          skipped: true,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  deps.log.info('summaries run complete', {
    households: householdIds.length,
    periods,
    inserted: results.filter((r) => !r.skipped).length,
    skipped: results.filter((r) => r.skipped).length,
  });

  return results;
}

async function runOneHouseholdPeriod(
  deps: SummariesWorkerDeps,
  householdId: string,
  period: SummaryPeriod,
  now: Date,
): Promise<SummariesRunResult> {
  const { coveredStart, coveredEnd, priorStart, priorEnd } = computePeriodWindow(period, now);

  const existing = await findExistingSummary(deps.supabase, householdId, period, coveredStart);
  if (existing) {
    return {
      householdId,
      period,
      skipped: true,
      reason: 'already_exists',
    };
  }

  const [transactions, accounts, budgets, priorSpendCents] = await Promise.all([
    loadTransactions(deps.supabase, householdId, coveredStart, coveredEnd),
    loadAccounts(deps.supabase, householdId),
    loadBudgets(deps.supabase, householdId),
    loadSpendInWindow(deps.supabase, householdId, priorStart, priorEnd),
  ]);

  const input: FinancialSummaryInput = {
    householdId: householdId as HouseholdId,
    period,
    coveredStart,
    coveredEnd,
    transactions,
    accounts,
    budgets,
    priorPeriodSpendCents: priorSpendCents,
    now,
  };

  const rendered: FinancialSummaryOutput = renderFinancialSummary(input);

  const insertedId = await insertSummary(deps.supabase, {
    householdId,
    period,
    coveredStart,
    coveredEnd,
    bodyMd: rendered.bodyMd,
  });

  await writeAudit(deps.supabase, {
    household_id: householdId,
    action: 'summary.financial.generated',
    resource_id: insertedId,
    after: {
      period,
      covered_start: coveredStart,
      covered_end: coveredEnd,
      metrics: rendered.metrics,
    },
  });

  return { householdId, period, skipped: false, insertedId };
}

/**
 * Compute `[coveredStart, coveredEnd)` for the period that just ended.
 * Crons run right after midnight on the first day of the *next* period,
 * so we produce the summary for the period that finished at `now`.
 */
export function computePeriodWindow(
  period: SummaryPeriod,
  now: Date,
): {
  coveredStart: string;
  coveredEnd: string;
  priorStart: string;
  priorEnd: string;
} {
  if (period === 'weekly') {
    // This Monday (00:00Z) and previous Monday.
    const thisMonday = mondayUtc(now);
    const previousMonday = new Date(thisMonday);
    previousMonday.setUTCDate(previousMonday.getUTCDate() - 7);
    const twoMondaysAgo = new Date(previousMonday);
    twoMondaysAgo.setUTCDate(twoMondaysAgo.getUTCDate() - 7);
    return {
      coveredStart: previousMonday.toISOString(),
      coveredEnd: thisMonday.toISOString(),
      priorStart: twoMondaysAgo.toISOString(),
      priorEnd: previousMonday.toISOString(),
    };
  }
  if (period === 'monthly') {
    const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const twoMonthsAgoStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
    return {
      coveredStart: lastMonthStart.toISOString(),
      coveredEnd: thisMonthStart.toISOString(),
      priorStart: twoMonthsAgoStart.toISOString(),
      priorEnd: lastMonthStart.toISOString(),
    };
  }
  // Daily — previous UTC day.
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yesterday = new Date(todayStart);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const dayBefore = new Date(yesterday);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  return {
    coveredStart: yesterday.toISOString(),
    coveredEnd: todayStart.toISOString(),
    priorStart: dayBefore.toISOString(),
    priorEnd: yesterday.toISOString(),
  };
}

function mondayUtc(d: Date): Date {
  const midnight = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0),
  );
  const dow = midnight.getUTCDay(); // 0=Sun
  const offset = dow === 0 ? 6 : dow - 1;
  midnight.setUTCDate(midnight.getUTCDate() - offset);
  return midnight;
}

async function listHouseholds(supabase: SupabaseClient<Database>): Promise<string[]> {
  const { data, error } = await supabase.schema('app').from('household').select('id').limit(10_000);
  if (error) throw new Error(`household scan failed: ${error.message}`);
  return (data ?? []).map((r) => r.id as string);
}

async function findExistingSummary(
  supabase: SupabaseClient<Database>,
  householdId: string,
  period: SummaryPeriod,
  coveredStart: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .schema('app')
    .from('summary')
    .select('id')
    .eq('household_id', householdId)
    .eq('segment', SUMMARY_SEGMENT)
    .eq('period', period)
    .eq('covered_start', coveredStart)
    .limit(1);
  if (error) throw new Error(`summary lookup failed: ${error.message}`);
  return (data ?? []).length > 0;
}

async function loadTransactions(
  supabase: SupabaseClient<Database>,
  householdId: string,
  startIso: string,
  endIso: string,
): Promise<SummaryTransactionRow[]> {
  const { data, error } = await supabase
    .schema('app')
    .from('transaction')
    .select(
      'id, household_id, account_id, occurred_at, amount_cents, currency, merchant_raw, category, source, metadata',
    )
    .eq('household_id', householdId)
    .gte('occurred_at', startIso)
    .lt('occurred_at', endIso);
  if (error) throw new Error(`transaction lookup failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    household_id: r.household_id as string,
    account_id: (r.account_id as string | null) ?? null,
    occurred_at: r.occurred_at as string,
    amount_cents: Number(r.amount_cents),
    currency: r.currency as string,
    merchant_raw: (r.merchant_raw as string | null) ?? null,
    category: (r.category as string | null) ?? null,
    source: r.source as string,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
  }));
}

async function loadAccounts(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<SummaryAccountRow[]> {
  const { data, error } = await supabase
    .schema('app')
    .from('account')
    .select('id, household_id, name, kind, balance_cents, currency, last_synced_at')
    .eq('household_id', householdId);
  if (error) throw new Error(`account lookup failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    household_id: r.household_id as string,
    name: r.name as string,
    kind: r.kind as string,
    balance_cents: r.balance_cents === null ? null : Number(r.balance_cents),
    currency: r.currency as string,
    last_synced_at: (r.last_synced_at as string | null) ?? null,
  }));
}

async function loadBudgets(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<SummaryBudgetRow[]> {
  const { data, error } = await supabase
    .schema('app')
    .from('budget')
    .select('id, household_id, name, category, period, amount_cents, currency')
    .eq('household_id', householdId);
  if (error) throw new Error(`budget lookup failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    household_id: r.household_id as string,
    name: r.name as string,
    category: r.category as string,
    period: r.period as 'weekly' | 'monthly' | 'yearly',
    amount_cents: Number(r.amount_cents),
    currency: r.currency as string,
  }));
}

async function loadSpendInWindow(
  supabase: SupabaseClient<Database>,
  householdId: string,
  startIso: string,
  endIso: string,
): Promise<number> {
  const txs = await loadTransactions(supabase, householdId, startIso, endIso);
  let total = 0;
  for (const tx of txs) {
    if (tx.amount_cents < 0) total += Math.abs(tx.amount_cents);
  }
  return total;
}

async function insertSummary(
  supabase: SupabaseClient<Database>,
  args: {
    householdId: string;
    period: SummaryPeriod;
    coveredStart: string;
    coveredEnd: string;
    bodyMd: string;
  },
): Promise<string> {
  const insert: Database['app']['Tables']['summary']['Insert'] = {
    household_id: args.householdId,
    segment: SUMMARY_SEGMENT,
    period: args.period,
    covered_start: args.coveredStart,
    covered_end: args.coveredEnd,
    body_md: args.bodyMd,
    model: SUMMARY_MODEL_LABEL,
  };
  const { data, error } = await supabase
    .schema('app')
    .from('summary')
    .insert(insert)
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`summary insert failed: ${error?.message ?? 'no id'}`);
  }
  return data.id as string;
}

async function writeAudit(
  supabase: SupabaseClient<Database>,
  input: { household_id: string; action: string; resource_id: string; after: unknown },
): Promise<void> {
  const { error } = await supabase
    .schema('audit')
    .from('event')
    .insert({
      household_id: input.household_id,
      actor_user_id: null,
      action: input.action,
      resource_type: 'app.summary',
      resource_id: input.resource_id,
      before: null,
      after: input.after as Json,
    });
  if (error) {
    console.warn(`[worker-summaries] audit write failed: ${error.message}`);
  }
}

// ---- Fun summaries ----------------------------------------------------

/**
 * Run fun-segment summaries per household × period. Mirrors the
 * financial runner but reads `app.event where segment='fun'` and writes
 * rows with `segment='fun'`.
 */
export async function runFunSummariesWorker(
  deps: SummariesWorkerDeps,
): Promise<SummariesRunResult[]> {
  const now = (deps.now ?? (() => new Date()))();
  const periods = deps.periods ?? ['weekly'];
  const householdIds = deps.householdIds ?? (await listHouseholds(deps.supabase));
  const results: SummariesRunResult[] = [];

  for (const householdId of householdIds) {
    for (const period of periods) {
      try {
        const result = await runOneFunHouseholdPeriod(deps, householdId, period, now);
        results.push(result);
      } catch (err) {
        deps.log.error('fun summaries: household/period run failed', {
          household_id: householdId,
          period,
          error: err instanceof Error ? err.message : String(err),
        });
        results.push({
          householdId,
          period,
          skipped: true,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  deps.log.info('fun summaries run complete', {
    households: householdIds.length,
    periods,
    inserted: results.filter((r) => !r.skipped).length,
    skipped: results.filter((r) => r.skipped).length,
  });

  return results;
}

async function runOneFunHouseholdPeriod(
  deps: SummariesWorkerDeps,
  householdId: string,
  period: SummaryPeriod,
  now: Date,
): Promise<SummariesRunResult> {
  const { coveredStart, coveredEnd } = computePeriodWindow(period, now);

  const existing = await findExistingFunSummary(deps.supabase, householdId, period, coveredStart);
  if (existing) {
    return { householdId, period, skipped: true, reason: 'already_exists' };
  }

  const [events, upcoming] = await Promise.all([
    loadFunEvents(deps.supabase, householdId, coveredStart, coveredEnd),
    loadFunEvents(
      deps.supabase,
      householdId,
      now.toISOString(),
      new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    ),
  ]);

  const input: FunSummaryInput = {
    householdId: householdId as HouseholdId,
    period,
    coveredStart,
    coveredEnd,
    events,
    upcomingEvents: upcoming,
    now,
  };
  const rendered: FunSummaryOutput = renderFunSummary(input);

  const insertedId = await insertFunSummary(deps.supabase, {
    householdId,
    period,
    coveredStart,
    coveredEnd,
    bodyMd: rendered.bodyMd,
  });

  await writeAudit(deps.supabase, {
    household_id: householdId,
    action: 'summary.fun.generated',
    resource_id: insertedId,
    after: {
      period,
      covered_start: coveredStart,
      covered_end: coveredEnd,
      metrics: rendered.metrics,
    },
  });

  return { householdId, period, skipped: false, insertedId };
}

async function findExistingFunSummary(
  supabase: SupabaseClient<Database>,
  householdId: string,
  period: SummaryPeriod,
  coveredStart: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .schema('app')
    .from('summary')
    .select('id')
    .eq('household_id', householdId)
    .eq('segment', 'fun')
    .eq('period', period)
    .eq('covered_start', coveredStart)
    .limit(1);
  if (error) throw new Error(`fun summary lookup failed: ${error.message}`);
  return (data ?? []).length > 0;
}

async function loadFunEvents(
  supabase: SupabaseClient<Database>,
  householdId: string,
  startIso: string,
  endIso: string,
): Promise<SummaryFunEventRow[]> {
  const { data, error } = await supabase
    .schema('app')
    .from('event')
    .select('id, household_id, segment, kind, title, starts_at, ends_at, location, metadata')
    .eq('household_id', householdId)
    .eq('segment', 'fun')
    .gte('starts_at', startIso)
    .lt('starts_at', endIso);
  if (error) throw new Error(`fun event lookup failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    household_id: r.household_id as string,
    segment: r.segment as string,
    kind: r.kind as string,
    title: r.title as string,
    starts_at: r.starts_at as string,
    ends_at: (r.ends_at as string | null) ?? null,
    location: (r.location as string | null) ?? null,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
  }));
}

async function insertFunSummary(
  supabase: SupabaseClient<Database>,
  args: {
    householdId: string;
    period: SummaryPeriod;
    coveredStart: string;
    coveredEnd: string;
    bodyMd: string;
  },
): Promise<string> {
  const insert: Database['app']['Tables']['summary']['Insert'] = {
    household_id: args.householdId,
    segment: 'fun',
    period: args.period,
    covered_start: args.coveredStart,
    covered_end: args.coveredEnd,
    body_md: args.bodyMd,
    model: SUMMARY_MODEL_LABEL,
  };
  const { data, error } = await supabase
    .schema('app')
    .from('summary')
    .insert(insert)
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`fun summary insert failed: ${error?.message ?? 'no id'}`);
  }
  return data.id as string;
}

// ---- Food summaries --------------------------------------------------------

/**
 * Run food summaries for the given households + periods. Mirrors the
 * financial/fun pattern: dedupe on `(household_id, segment='food', period,
 * covered_start)` and write `app.summary` with `model='deterministic'`.
 */
export async function runFoodSummariesWorker(
  deps: SummariesWorkerDeps,
): Promise<SummariesRunResult[]> {
  const now = (deps.now ?? (() => new Date()))();
  const periods = deps.periods ?? ['weekly'];
  const householdIds = deps.householdIds ?? (await listHouseholds(deps.supabase));
  const results: SummariesRunResult[] = [];
  for (const householdId of householdIds) {
    for (const period of periods) {
      try {
        const result = await runOneFoodHouseholdPeriod(deps, householdId, period, now);
        results.push(result);
      } catch (err) {
        deps.log.error('food summaries: household/period run failed', {
          household_id: householdId,
          period,
          error: err instanceof Error ? err.message : String(err),
        });
        results.push({
          householdId,
          period,
          skipped: true,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  deps.log.info('food summaries run complete', {
    households: householdIds.length,
    periods,
    inserted: results.filter((r) => !r.skipped).length,
    skipped: results.filter((r) => r.skipped).length,
  });
  return results;
}

async function runOneFoodHouseholdPeriod(
  deps: SummariesWorkerDeps,
  householdId: string,
  period: SummaryPeriod,
  now: Date,
): Promise<SummariesRunResult> {
  const { coveredStart, coveredEnd } = computePeriodWindow(period, now);

  const existing = await findExistingFoodSummary(deps.supabase, householdId, period, coveredStart);
  if (existing) {
    return { householdId, period, skipped: true, reason: 'already_exists' };
  }

  const [meals, pantryItems, memberNamesById] = await Promise.all([
    loadMealsInWindow(deps.supabase, householdId, coveredStart, coveredEnd),
    loadPantryItemsInWindow(deps.supabase, householdId, coveredStart, coveredEnd),
    loadMemberNames(deps.supabase, householdId),
  ]);

  const input: FoodSummaryInput = {
    householdId: householdId as HouseholdId,
    period,
    coveredStart,
    coveredEnd,
    meals,
    pantryItems,
    memberNamesById,
    now,
  };
  const rendered: FoodSummaryOutput = renderFoodSummary(input);

  const insertedId = await insertFoodSummary(deps.supabase, {
    householdId,
    period,
    coveredStart,
    coveredEnd,
    bodyMd: rendered.bodyMd,
  });

  await writeAudit(deps.supabase, {
    household_id: householdId,
    action: 'summary.food.generated',
    resource_id: insertedId,
    after: {
      period,
      covered_start: coveredStart,
      covered_end: coveredEnd,
      metrics: rendered.metrics,
    },
  });
  return { householdId, period, skipped: false, insertedId };
}

async function findExistingFoodSummary(
  supabase: SupabaseClient<Database>,
  householdId: string,
  period: SummaryPeriod,
  coveredStart: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .schema('app')
    .from('summary')
    .select('id')
    .eq('household_id', householdId)
    .eq('segment', 'food')
    .eq('period', period)
    .eq('covered_start', coveredStart)
    .limit(1);
  if (error) throw new Error(`food summary lookup failed: ${error.message}`);
  return (data ?? []).length > 0;
}

async function loadMealsInWindow(
  supabase: SupabaseClient<Database>,
  householdId: string,
  startIso: string,
  endIso: string,
): Promise<MealSummaryRow[]> {
  const { data, error } = await supabase
    .schema('app')
    .from('meal')
    .select('id, household_id, planned_for, slot, title, dish_node_id, cook_member_id, status')
    .eq('household_id', householdId)
    .gte('planned_for', startIso.slice(0, 10))
    .lt('planned_for', endIso.slice(0, 10));
  if (error) throw new Error(`food meal lookup failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    household_id: r.household_id as string,
    planned_for: r.planned_for as string,
    slot: r.slot as MealSummaryRow['slot'],
    title: r.title as string,
    dish_node_id: (r.dish_node_id as string | null) ?? null,
    cook_member_id: (r.cook_member_id as string | null) ?? null,
    status: r.status as MealSummaryRow['status'],
  }));
}

async function loadPantryItemsInWindow(
  supabase: SupabaseClient<Database>,
  householdId: string,
  startIso: string,
  endIso: string,
): Promise<PantryItemSummaryRow[]> {
  const { data, error } = await supabase
    .schema('app')
    .from('pantry_item')
    .select('id, household_id, name, expires_on')
    .eq('household_id', householdId)
    .gte('expires_on', startIso.slice(0, 10))
    .lt('expires_on', endIso.slice(0, 10));
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id as string,
    household_id: r.household_id as string,
    name: r.name as string,
    expires_on: (r.expires_on as string | null) ?? null,
  }));
}

async function loadMemberNames(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .schema('app')
    .from('member')
    .select('id, display_name')
    .eq('household_id', householdId);
  const out = new Map<string, string>();
  if (error || !data) return out;
  for (const row of data) {
    out.set(row.id as string, (row.display_name as string | null) ?? 'Unknown');
  }
  return out;
}

async function insertFoodSummary(
  supabase: SupabaseClient<Database>,
  args: {
    householdId: string;
    period: SummaryPeriod;
    coveredStart: string;
    coveredEnd: string;
    bodyMd: string;
  },
): Promise<string> {
  const insert: Database['app']['Tables']['summary']['Insert'] = {
    household_id: args.householdId,
    segment: 'food',
    period: args.period,
    covered_start: args.coveredStart,
    covered_end: args.coveredEnd,
    body_md: args.bodyMd,
    model: SUMMARY_MODEL_LABEL,
  };
  const { data, error } = await supabase
    .schema('app')
    .from('summary')
    .insert(insert)
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`food summary insert failed: ${error?.message ?? 'no id'}`);
  }
  return data.id as string;
}

// ---- Social summaries ---------------------------------------------------

export async function runSocialSummariesWorker(
  deps: SummariesWorkerDeps,
): Promise<SummariesRunResult[]> {
  const now = (deps.now ?? (() => new Date()))();
  const periods = deps.periods ?? ['weekly'];
  const householdIds = deps.householdIds ?? (await listHouseholds(deps.supabase));
  const results: SummariesRunResult[] = [];
  for (const householdId of householdIds) {
    for (const period of periods) {
      try {
        const result = await runOneSocialHouseholdPeriod(deps, householdId, period, now);
        results.push(result);
      } catch (err) {
        deps.log.error('social summaries: household/period run failed', {
          household_id: householdId,
          period,
          error: err instanceof Error ? err.message : String(err),
        });
        results.push({
          householdId,
          period,
          skipped: true,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  deps.log.info('social summaries run complete', {
    households: householdIds.length,
    periods,
    inserted: results.filter((r) => !r.skipped).length,
    skipped: results.filter((r) => r.skipped).length,
  });
  return results;
}

async function runOneSocialHouseholdPeriod(
  deps: SummariesWorkerDeps,
  householdId: string,
  period: SummaryPeriod,
  now: Date,
): Promise<SummariesRunResult> {
  const { coveredStart, coveredEnd } = computePeriodWindow(period, now);

  const existing = await findExistingSocialSummary(
    deps.supabase,
    householdId,
    period,
    coveredStart,
  );
  if (existing) {
    return { householdId, period, skipped: true, reason: 'already_exists' };
  }

  const [episodes, people, upcomingEvents] = await Promise.all([
    loadSocialEpisodesInWindow(deps.supabase, householdId, coveredStart, coveredEnd),
    loadSocialPeople(deps.supabase, householdId),
    loadUpcomingSocialEvents(deps.supabase, householdId, coveredEnd),
  ]);

  const personNames = new Map<string, string>();
  for (const p of people) personNames.set(p.id, p.canonical_name);

  // Absent persons — read from the alerts worker's live emissions
  // (stashed in `app.alert` under `segment='social' and kind='absence_long'`)
  // as a simple integration point. Empty when the alerts worker has
  // not yet run.
  const absentPersons = await loadRecentAbsenceFlags(deps.supabase, householdId, coveredStart);

  const input: SocialSummaryInput = {
    householdId: householdId as HouseholdId,
    period,
    coveredStart,
    coveredEnd,
    episodes,
    people,
    upcomingEvents,
    absentPersons,
    personNames,
    now,
  };
  const rendered: SocialSummaryOutput = renderSocialSummary(input);

  const insertedId = await insertSocialSummary(deps.supabase, {
    householdId,
    period,
    coveredStart,
    coveredEnd,
    bodyMd: rendered.bodyMd,
  });

  await writeAudit(deps.supabase, {
    household_id: householdId,
    action: 'summary.social.generated',
    resource_id: insertedId,
    after: {
      period,
      covered_start: coveredStart,
      covered_end: coveredEnd,
      metrics: rendered.metrics,
    },
  });
  return { householdId, period, skipped: false, insertedId };
}

async function findExistingSocialSummary(
  supabase: SupabaseClient<Database>,
  householdId: string,
  period: SummaryPeriod,
  coveredStart: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .schema('app')
    .from('summary')
    .select('id')
    .eq('household_id', householdId)
    .eq('segment', 'social')
    .eq('period', period)
    .eq('covered_start', coveredStart)
    .limit(1);
  if (error) throw new Error(`social summary lookup failed: ${error.message}`);
  return (data ?? []).length > 0;
}

async function loadSocialEpisodesInWindow(
  supabase: SupabaseClient<Database>,
  householdId: string,
  startIso: string,
  endIso: string,
): Promise<SocialEpisodeRow[]> {
  const { data, error } = await supabase
    .schema('mem')
    .from('episode')
    .select('id, household_id, occurred_at, participants, place_node_id, source_type, metadata')
    .eq('household_id', householdId)
    .gte('occurred_at', startIso)
    .lt('occurred_at', endIso);
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id as string,
    household_id: r.household_id as string,
    occurred_at: r.occurred_at as string,
    participants: (r.participants as string[] | null) ?? [],
    place_node_id: (r.place_node_id as string | null) ?? null,
    source_type: r.source_type as string,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
  }));
}

async function loadSocialPeople(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<SocialPersonRow[]> {
  const { data, error } = await supabase
    .schema('mem')
    .from('node')
    .select('id, household_id, canonical_name, metadata, created_at')
    .eq('household_id', householdId)
    .eq('type', 'person');
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id as string,
    household_id: r.household_id as string,
    canonical_name: r.canonical_name as string,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: r.created_at as string,
  }));
}

async function loadUpcomingSocialEvents(
  supabase: SupabaseClient<Database>,
  householdId: string,
  coveredEndIso: string,
): Promise<SocialEventRow[]> {
  const { data, error } = await supabase
    .schema('app')
    .from('event')
    .select('id, household_id, kind, title, starts_at, metadata')
    .eq('household_id', householdId)
    .eq('segment', 'social')
    .gte('starts_at', coveredEndIso);
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id as string,
    household_id: r.household_id as string,
    kind: r.kind as string,
    title: r.title as string,
    starts_at: r.starts_at as string,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
  }));
}

async function loadRecentAbsenceFlags(
  supabase: SupabaseClient<Database>,
  householdId: string,
  coveredStartIso: string,
): Promise<SocialAbsentPerson[]> {
  const { data, error } = await supabase
    .schema('app')
    .from('alert')
    .select('context, generated_at')
    .eq('household_id', householdId)
    .eq('segment', 'social')
    .gte('generated_at', coveredStartIso);
  if (error) return [];
  const out: SocialAbsentPerson[] = [];
  const seen = new Set<string>();
  for (const row of data ?? []) {
    const ctx = (row.context as Record<string, unknown> | null) ?? {};
    if (ctx['alert_kind'] !== 'absence_long') continue;
    const pid = ctx['person_node_id'];
    if (typeof pid !== 'string' || seen.has(pid)) continue;
    seen.add(pid);
    out.push({
      id: pid,
      household_id: householdId,
      canonical_name: (ctx['person_name'] as string) ?? 'Unknown',
      lastSeenAt: (ctx['last_seen_at'] as string | null) ?? null,
    });
  }
  return out;
}

async function insertSocialSummary(
  supabase: SupabaseClient<Database>,
  args: {
    householdId: string;
    period: SummaryPeriod;
    coveredStart: string;
    coveredEnd: string;
    bodyMd: string;
  },
): Promise<string> {
  const insert: Database['app']['Tables']['summary']['Insert'] = {
    household_id: args.householdId,
    segment: 'social',
    period: args.period,
    covered_start: args.coveredStart,
    covered_end: args.coveredEnd,
    body_md: args.bodyMd,
    model: SUMMARY_MODEL_LABEL,
  };
  const { data, error } = await supabase
    .schema('app')
    .from('summary')
    .insert(insert)
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`social summary insert failed: ${error?.message ?? 'no id'}`);
  }
  return data.id as string;
}

// Legacy stub kept for the old handler.test.ts entry which only checked
// the symbol existed. Remove once downstream callers migrate.
export async function handler(): Promise<void> {
  throw new Error('summaries: use runSummariesWorker() instead of handler()');
}
