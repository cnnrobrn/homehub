/**
 * Pure aggregation helpers for `/ops/model-usage`.
 *
 * Extracted from `./modelUsage.ts` so unit tests can exercise the
 * rollup without pulling the auth-server + Supabase client into the
 * test process (those transitively reach the M9-A approval-flow
 * package which may not be built in every test run).
 */

export interface ModelCallRow {
  task: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number | null;
  at: string;
}

export interface TaskRollup {
  task: string;
  calls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
}

export interface ModelRollup {
  model: string;
  calls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface DailyRollup {
  day: string;
  costUsd: number;
  calls: number;
}

export interface ModelUsageRollup {
  totalCallsMtd: number;
  totalCostUsdMtd: number;
  monthBudgetUsd: number | null;
  monthUsedUsd: number;
  monthUsedPct: number | null;
  topTasks: TaskRollup[];
  byModel: ModelRollup[];
  byDay: DailyRollup[];
  taskLatency: TaskRollup[];
}

/** Nearest-rank percentile. Matches PostgreSQL's `percentile_disc`. */
export function percentile(sortedAsc: readonly number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const rank = Math.ceil((p / 100) * sortedAsc.length) - 1;
  const idx = Math.min(Math.max(rank, 0), sortedAsc.length - 1);
  return sortedAsc[idx] ?? null;
}

export function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function rollupModelCalls(
  rows: readonly ModelCallRow[],
  monthStart: Date,
  monthBudgetUsd: number | null,
): ModelUsageRollup {
  let mtdCalls = 0;
  let mtdCost = 0;
  for (const r of rows) {
    const at = new Date(r.at);
    if (at >= monthStart) {
      mtdCalls += 1;
      mtdCost += Number(r.cost_usd ?? 0);
    }
  }

  const taskBuckets = new Map<
    string,
    { calls: number; cost: number; input: number; output: number; latencies: number[] }
  >();
  for (const r of rows) {
    const bucket = taskBuckets.get(r.task) ?? {
      calls: 0,
      cost: 0,
      input: 0,
      output: 0,
      latencies: [] as number[],
    };
    bucket.calls += 1;
    bucket.cost += Number(r.cost_usd ?? 0);
    bucket.input += r.input_tokens ?? 0;
    bucket.output += r.output_tokens ?? 0;
    if (typeof r.latency_ms === 'number' && r.latency_ms >= 0) {
      bucket.latencies.push(r.latency_ms);
    }
    taskBuckets.set(r.task, bucket);
  }
  const topTasks: TaskRollup[] = [...taskBuckets.entries()]
    .map(([task, b]) => {
      const sorted = [...b.latencies].sort((a, z) => a - z);
      return {
        task,
        calls: b.calls,
        costUsd: b.cost,
        inputTokens: b.input,
        outputTokens: b.output,
        latencyP50Ms: percentile(sorted, 50),
        latencyP95Ms: percentile(sorted, 95),
      } satisfies TaskRollup;
    })
    .sort((a, z) => z.costUsd - a.costUsd)
    .slice(0, 10);

  const taskLatency: TaskRollup[] = [...taskBuckets.entries()]
    .map(([task, b]) => {
      const sorted = [...b.latencies].sort((a, z) => a - z);
      return {
        task,
        calls: b.calls,
        costUsd: b.cost,
        inputTokens: b.input,
        outputTokens: b.output,
        latencyP50Ms: percentile(sorted, 50),
        latencyP95Ms: percentile(sorted, 95),
      } satisfies TaskRollup;
    })
    .sort((a, z) => (z.latencyP95Ms ?? 0) - (a.latencyP95Ms ?? 0))
    .slice(0, 10);

  const modelBuckets = new Map<
    string,
    { calls: number; cost: number; input: number; output: number }
  >();
  for (const r of rows) {
    const b = modelBuckets.get(r.model) ?? { calls: 0, cost: 0, input: 0, output: 0 };
    b.calls += 1;
    b.cost += Number(r.cost_usd ?? 0);
    b.input += r.input_tokens ?? 0;
    b.output += r.output_tokens ?? 0;
    modelBuckets.set(r.model, b);
  }
  const byModel: ModelRollup[] = [...modelBuckets.entries()]
    .map(([model, b]) => ({
      model,
      calls: b.calls,
      costUsd: b.cost,
      inputTokens: b.input,
      outputTokens: b.output,
    }))
    .sort((a, z) => z.costUsd - a.costUsd);

  const dayBuckets = new Map<string, { cost: number; calls: number }>();
  for (const r of rows) {
    const d = new Date(r.at);
    const day = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const b = dayBuckets.get(day) ?? { cost: 0, calls: 0 };
    b.cost += Number(r.cost_usd ?? 0);
    b.calls += 1;
    dayBuckets.set(day, b);
  }
  const byDay: DailyRollup[] = [...dayBuckets.entries()]
    .map(([day, b]) => ({ day, costUsd: b.cost, calls: b.calls }))
    .sort((a, z) => a.day.localeCompare(z.day));

  const pct =
    monthBudgetUsd !== null && monthBudgetUsd > 0
      ? Math.min(100, (mtdCost / monthBudgetUsd) * 100)
      : null;

  return {
    totalCallsMtd: mtdCalls,
    totalCostUsdMtd: mtdCost,
    monthBudgetUsd,
    monthUsedUsd: mtdCost,
    monthUsedPct: pct,
    topTasks,
    byModel,
    byDay,
    taskLatency,
  };
}

/**
 * Reads `household.settings.memory.model_budget_monthly_cents` defensively.
 * Returns null if the value is missing or malformed.
 */
export function extractMonthlyBudgetCents(settings: unknown): number | null {
  if (!settings || typeof settings !== 'object') return null;
  const memory = (settings as Record<string, unknown>).memory;
  if (!memory || typeof memory !== 'object') return null;
  const v = (memory as Record<string, unknown>).model_budget_monthly_cents;
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  return null;
}
