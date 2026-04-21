/**
 * Server-side reader for `/ops/model-usage`.
 *
 * Aggregates `app.model_calls` rows for one household. The pure
 * aggregation logic lives in `./modelUsageRollup.ts` so unit tests can
 * exercise it without pulling the auth-server + Supabase client into
 * the test process.
 *
 * RLS note: `app.model_calls` is owner-read (migration 0009). We use
 * the service client and scope the query with an explicit
 * `household_id = ?` filter, which matches the RLS policy's intent
 * while keeping latency small (no recursive RLS check).
 */

import { createServiceClient } from '@homehub/auth-server';
import { z } from 'zod';

import {
  extractMonthlyBudgetCents,
  rollupModelCalls,
  startOfMonthUtc,
  type ModelCallRow,
  type ModelUsageRollup,
} from './modelUsageRollup';

import { authEnv } from '@/lib/auth/env';

export type { DailyRollup, ModelRollup, TaskRollup } from './modelUsageRollup';

export const modelUsageArgsSchema = z.object({
  householdId: z.string().uuid(),
  /** Window end (exclusive). Defaults to now. */
  to: z.date().optional(),
  /** Window start (inclusive). Defaults to 30 days ago. */
  from: z.date().optional(),
});

export type ModelUsageArgs = z.infer<typeof modelUsageArgsSchema>;

export interface ModelUsageReport extends ModelUsageRollup {
  windowFromIso: string;
  windowToIso: string;
}

interface HouseholdSettingsRow {
  settings: unknown;
}

/**
 * Reads model_calls + household settings and assembles the report.
 */
export async function getModelUsageReport(args: ModelUsageArgs): Promise<ModelUsageReport> {
  const parsed = modelUsageArgsSchema.parse(args);
  const to = parsed.to ?? new Date();
  // Default window: from start of month or 30 days ago, whichever is
  // earlier, so the dashboard shows at least one month of history even
  // on the 1st.
  const defaultFrom = (() => {
    const thirtyAgo = new Date(to.getTime() - 30 * 86_400_000);
    const monthStart = startOfMonthUtc(to);
    return thirtyAgo < monthStart ? thirtyAgo : monthStart;
  })();
  const from = parsed.from ?? defaultFrom;

  const env = authEnv();
  const service = createServiceClient(env);

  const { data: callsData, error: callsErr } = await service
    .schema('app')
    .from('model_calls')
    .select('task, model, input_tokens, output_tokens, cost_usd, latency_ms, at')
    .eq('household_id', parsed.householdId)
    .gte('at', from.toISOString())
    .lt('at', to.toISOString())
    .order('at', { ascending: false })
    .limit(5000);
  if (callsErr) {
    throw new Error(`model_calls query failed: ${callsErr.message}`);
  }

  const { data: hhData, error: hhErr } = await service
    .schema('app')
    .from('household')
    .select('settings')
    .eq('id', parsed.householdId)
    .maybeSingle();
  if (hhErr) {
    throw new Error(`household settings query failed: ${hhErr.message}`);
  }

  const settings = (hhData as HouseholdSettingsRow | null)?.settings ?? {};
  const budgetCents = extractMonthlyBudgetCents(settings);
  const monthBudgetUsd = budgetCents !== null ? budgetCents / 100 : null;

  const rows = (callsData ?? []) as unknown as ModelCallRow[];
  const rollups = rollupModelCalls(rows, startOfMonthUtc(to), monthBudgetUsd);

  return {
    windowFromIso: from.toISOString(),
    windowToIso: to.toISOString(),
    ...rollups,
  };
}
