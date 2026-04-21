/**
 * `/ops/health` — owner dashboard for worker heartbeats, queue depths,
 * provider connections, and recent audit events.
 *
 * Deliberately plain + refresh-driven. No realtime subscriptions; a
 * link-based "Refresh" button replays the Server Component.
 *
 * Owner enforcement in the parent `(app)/ops/layout.tsx` shell.
 */

import { requireHouseholdContext } from '@/lib/auth/context';
import {
  getHealthReport,
  type AuditEventSummary,
  type ProviderConnectionSummary,
  type QueueMetric,
  type WorkerHeartbeat,
} from '@/lib/ops/health';

export const dynamic = 'force-dynamic';

function fmtAge(ms: number): string {
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

function HeartbeatRow({ h }: { h: WorkerHeartbeat }) {
  const age = Date.now() - new Date(h.lastSeenAt).getTime();
  return (
    <tr className="border-t border-border/70">
      <td className="px-3 py-2 font-mono text-xs">{h.service}</td>
      <td className="px-3 py-2 font-mono text-xs text-fg-muted">{h.component}</td>
      <td className="px-3 py-2 text-xs tabular-nums">{fmtAge(age)} ago</td>
      <td className="px-3 py-2 text-xs">
        {h.stale ? (
          <span className="rounded bg-red-500/10 px-2 py-0.5 text-red-600">stale</span>
        ) : (
          <span className="rounded bg-green-500/10 px-2 py-0.5 text-green-600">ok</span>
        )}
      </td>
    </tr>
  );
}

function QueueRow({ q }: { q: QueueMetric }) {
  const ageDisplay =
    q.ageSec === null ? '—' : q.ageSec < 60 ? `${q.ageSec.toFixed(0)}s` : fmtAge(q.ageSec * 1000);
  const depthDisplay = q.depth === null ? '—' : q.depth.toString();
  return (
    <tr className="border-t border-border/70">
      <td className="px-3 py-2 font-mono text-xs">{q.queue}</td>
      <td className="px-3 py-2 text-right text-xs tabular-nums">{depthDisplay}</td>
      <td className="px-3 py-2 text-right text-xs tabular-nums">{ageDisplay}</td>
      <td className="px-3 py-2 text-xs text-red-600">{q.error ? q.error : ''}</td>
    </tr>
  );
}

function ConnectionsTable({ rows }: { rows: ProviderConnectionSummary[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-border bg-surface p-3 text-sm text-fg-muted">
        No provider connections recorded for this household.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-surface">
      <table className="min-w-full text-sm">
        <thead className="bg-bg/40 text-left text-xs uppercase tracking-wide text-fg-muted">
          <tr>
            <th className="px-3 py-2">Provider</th>
            <th className="px-3 py-2 text-right">Active</th>
            <th className="px-3 py-2 text-right">Paused</th>
            <th className="px-3 py-2 text-right">Errored</th>
            <th className="px-3 py-2 text-right">Revoked</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.provider} className="border-t border-border/70">
              <td className="px-3 py-2 font-mono text-xs">{r.provider}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.active}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.paused}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.errored}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.revoked}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditTable({ rows }: { rows: AuditEventSummary[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-border bg-surface p-3 text-sm text-fg-muted">
        No recent audit events.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-surface">
      <table className="min-w-full text-sm">
        <thead className="bg-bg/40 text-left text-xs uppercase tracking-wide text-fg-muted">
          <tr>
            <th className="px-3 py-2">When</th>
            <th className="px-3 py-2">Action</th>
            <th className="px-3 py-2">Resource</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border/70">
              <td className="px-3 py-2 text-xs tabular-nums text-fg-muted">
                {new Date(r.at).toLocaleString()}
              </td>
              <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
              <td className="px-3 py-2 font-mono text-xs text-fg-muted">
                {r.resourceType}
                {r.resourceId ? ` / ${r.resourceId.slice(0, 8)}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function OpsHealthPage() {
  const ctx = await requireHouseholdContext();

  let report: Awaited<ReturnType<typeof getHealthReport>> | null = null;
  let loadError: string | null = null;
  try {
    report = await getHealthReport(ctx.household.id);
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">Health</h2>
        <p className="text-sm text-fg-muted">
          Worker heartbeats, queue depths, connections, and recent audit events.
        </p>
      </header>

      {loadError ? (
        <div className="rounded-md border border-border bg-surface p-3 text-sm text-red-600">
          Failed to load health: {loadError}
        </div>
      ) : null}

      {report ? (
        <>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
              Worker heartbeats
            </h3>
            {report.heartbeatTablePending ? (
              <p className="rounded-md border border-border bg-surface p-3 text-sm text-fg-muted">
                Heartbeat table pending — will populate after migration 0014+.
              </p>
            ) : report.heartbeats.length === 0 ? (
              <p className="rounded-md border border-border bg-surface p-3 text-sm text-fg-muted">
                No heartbeats recorded yet.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border bg-surface">
                <table className="min-w-full text-sm">
                  <thead className="bg-bg/40 text-left text-xs uppercase tracking-wide text-fg-muted">
                    <tr>
                      <th className="px-3 py-2">Service</th>
                      <th className="px-3 py-2">Component</th>
                      <th className="px-3 py-2">Last seen</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.heartbeats.map((h) => (
                      <HeartbeatRow key={`${h.service}:${h.component}`} h={h} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">Queues</h3>
            <div className="overflow-x-auto rounded-md border border-border bg-surface">
              <table className="min-w-full text-sm">
                <thead className="bg-bg/40 text-left text-xs uppercase tracking-wide text-fg-muted">
                  <tr>
                    <th className="px-3 py-2">Queue</th>
                    <th className="px-3 py-2 text-right">Depth</th>
                    <th className="px-3 py-2 text-right">Age of oldest</th>
                    <th className="px-3 py-2">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {report.queues.map((q) => (
                    <QueueRow key={q.queue} q={q} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
              Provider connections (household)
            </h3>
            <ConnectionsTable rows={report.connections} />
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
              Recent audit events
            </h3>
            <AuditTable rows={report.recentAudit} />
          </div>
        </>
      ) : null}
    </section>
  );
}
