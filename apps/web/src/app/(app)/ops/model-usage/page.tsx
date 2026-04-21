/**
 * `/ops/model-usage` — per-household model spend + latency.
 *
 * Server Component. Pulls from `app.model_calls`, rolls up in Node, and
 * renders plain tables + CSS-width bars. No chart library; keeping the
 * v1 surface zero-dep both for bundle size and so the page works well
 * in a terminal-like screenshot for an incident.
 *
 * Owner-only enforcement lives in the `(app)/ops/layout.tsx` shell.
 */

import { requireHouseholdContext } from '@/lib/auth/context';
import {
  getModelUsageReport,
  type ModelUsageReport,
  type TaskRollup,
  type ModelRollup,
  type DailyRollup,
} from '@/lib/ops/modelUsage';

export const dynamic = 'force-dynamic';

function fmtUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function fmtInt(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function fmtMs(value: number | null): string {
  if (value === null) return '—';
  if (value < 1_000) return `${value.toFixed(0)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

function Bar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-bg/40">
      <div
        className="h-full rounded bg-accent"
        style={{ width: `${clamped}%` }}
        aria-hidden="true"
      />
    </div>
  );
}

function TasksTable({ rows }: { rows: TaskRollup[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-fg-muted">No task data in window.</p>;
  }
  const maxCost = Math.max(...rows.map((r) => r.costUsd), 0.0001);
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-surface">
      <table className="min-w-full text-sm">
        <thead className="bg-bg/40 text-left text-xs uppercase tracking-wide text-fg-muted">
          <tr>
            <th className="px-3 py-2">Task</th>
            <th className="px-3 py-2 text-right">Calls</th>
            <th className="px-3 py-2 text-right">Cost</th>
            <th className="px-3 py-2">Relative cost</th>
            <th className="px-3 py-2 text-right">p50 latency</th>
            <th className="px-3 py-2 text-right">p95 latency</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.task} className="border-t border-border/70">
              <td className="px-3 py-2 font-mono text-xs">{r.task}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.calls)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(r.costUsd)}</td>
              <td className="px-3 py-2">
                <Bar pct={(r.costUsd / maxCost) * 100} />
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtMs(r.latencyP50Ms)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtMs(r.latencyP95Ms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelTable({ rows }: { rows: ModelRollup[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-fg-muted">No model data in window.</p>;
  }
  const maxCost = Math.max(...rows.map((r) => r.costUsd), 0.0001);
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-surface">
      <table className="min-w-full text-sm">
        <thead className="bg-bg/40 text-left text-xs uppercase tracking-wide text-fg-muted">
          <tr>
            <th className="px-3 py-2">Model</th>
            <th className="px-3 py-2 text-right">Calls</th>
            <th className="px-3 py-2 text-right">In tokens</th>
            <th className="px-3 py-2 text-right">Out tokens</th>
            <th className="px-3 py-2 text-right">Cost</th>
            <th className="px-3 py-2">Relative cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.model} className="border-t border-border/70">
              <td className="px-3 py-2 font-mono text-xs">{r.model}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.calls)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.inputTokens)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.outputTokens)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(r.costUsd)}</td>
              <td className="px-3 py-2">
                <Bar pct={(r.costUsd / maxCost) * 100} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DailyTable({ rows }: { rows: DailyRollup[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-fg-muted">No daily data in window.</p>;
  }
  const maxCost = Math.max(...rows.map((r) => r.costUsd), 0.0001);
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-surface">
      <table className="min-w-full text-sm">
        <thead className="bg-bg/40 text-left text-xs uppercase tracking-wide text-fg-muted">
          <tr>
            <th className="px-3 py-2">Day</th>
            <th className="px-3 py-2 text-right">Calls</th>
            <th className="px-3 py-2 text-right">Cost</th>
            <th className="px-3 py-2">Relative cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.day} className="border-t border-border/70">
              <td className="px-3 py-2 font-mono text-xs">{r.day}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.calls)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(r.costUsd)}</td>
              <td className="px-3 py-2">
                <Bar pct={(r.costUsd / maxCost) * 100} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BudgetHeader({ report }: { report: ModelUsageReport }) {
  const used = fmtUsd(report.monthUsedUsd);
  const budget = report.monthBudgetUsd !== null ? fmtUsd(report.monthBudgetUsd) : 'no budget set';
  const pct = report.monthUsedPct;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-fg-muted">Month-to-date cost</div>
          <div className="text-2xl font-semibold tabular-nums">{used}</div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-fg-muted">Monthly budget</div>
          <div className="text-lg tabular-nums">{budget}</div>
        </div>
      </div>
      {pct !== null ? (
        <div className="flex flex-col gap-1">
          <Bar pct={pct} />
          <div className="text-xs text-fg-muted tabular-nums">{pct.toFixed(1)}% of budget used</div>
        </div>
      ) : null}
    </div>
  );
}

export default async function OpsModelUsagePage() {
  const ctx = await requireHouseholdContext();

  let report: ModelUsageReport | null = null;
  let loadError: string | null = null;
  try {
    report = await getModelUsageReport({ householdId: ctx.household.id });
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">Model usage</h2>
        <p className="text-sm text-fg-muted">
          Per-household model spend, calls, and latency. Rolled up from{' '}
          <code className="rounded bg-bg/40 px-1">app.model_calls</code>.
        </p>
      </header>

      {loadError ? (
        <div className="rounded-md border border-border bg-surface p-3 text-sm text-red-600">
          Failed to load model usage: {loadError}
        </div>
      ) : null}

      {report ? (
        <>
          <BudgetHeader report={report} />

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
              Top tasks by cost
            </h3>
            <TasksTable rows={report.topTasks} />
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
              Latency — top tasks by p95
            </h3>
            <TasksTable rows={report.taskLatency} />
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
              By model
            </h3>
            <ModelTable rows={report.byModel} />
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
              Daily (last 30 days)
            </h3>
            <DailyTable rows={report.byDay} />
          </div>

          <p className="text-xs text-fg-muted">
            Window: {new Date(report.windowFromIso).toUTCString()} →{' '}
            {new Date(report.windowToIso).toUTCString()}.
          </p>
        </>
      ) : null}
    </section>
  );
}
