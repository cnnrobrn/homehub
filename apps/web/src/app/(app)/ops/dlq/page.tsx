/**
 * `/ops/dlq` — dead-letter queue inspection for the current household.
 *
 * Server Component. Reads via `@homehub/dlq-admin` through the ops lib.
 * Owner gating is enforced by the parent `(app)/ops/layout.tsx`; we
 * still re-read the context here for the household id.
 *
 * Rendering is intentionally plain — no emojis, no charts, no realtime.
 * The Refresh control is a Link back to the same route so a click
 * replays the Server Component render with fresh data. Replay + Purge
 * actions are client-side forms that call server actions.
 */

import { DlqActions } from './actions-client';

import { requireHouseholdContext } from '@/lib/auth/context';
import { listDlqForHousehold, type DlqEntry } from '@/lib/ops/dlq';

export const dynamic = 'force-dynamic';

function prettyBytes(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export default async function OpsDlqPage() {
  const ctx = await requireHouseholdContext();
  // Owner enforcement handled in layout; guard again here for defense-
  // in-depth since this page is linked from the internal nav.
  if (ctx.member.role !== 'owner') {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Not found</h2>
      </div>
    );
  }

  let entries: DlqEntry[] = [];
  let loadError: string | null = null;
  try {
    entries = await listDlqForHousehold({ householdId: ctx.household.id, limit: 100 });
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">Dead-letter queue</h2>
          <p className="text-sm text-fg-muted">
            Messages the worker runtime gave up on. Replay after fixing the underlying issue.
          </p>
        </div>
      </header>

      {loadError ? (
        <div className="rounded-md border border-border bg-surface p-3 text-sm text-red-600">
          Failed to load DLQ: {loadError}
        </div>
      ) : null}

      {!loadError && entries.length === 0 ? (
        <div className="rounded-md border border-border bg-surface p-4 text-sm text-fg-muted">
          No dead-letter entries. Nothing to triage right now.
        </div>
      ) : null}

      {entries.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-border bg-surface">
          <table className="min-w-full text-sm">
            <thead className="bg-bg/40 text-left text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-3 py-2">Queue</th>
                <th className="px-3 py-2">Received</th>
                <th className="px-3 py-2">Error</th>
                <th className="px-3 py-2">Id</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-border/70">
                  <td className="px-3 py-2 font-mono text-xs">{e.queue}</td>
                  <td className="px-3 py-2 tabular-nums text-xs text-fg-muted">
                    {new Date(e.receivedAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-xs">{prettyBytes(e.error, 200)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-fg-muted">{e.id.slice(0, 8)}</td>
                  <td className="px-3 py-2">
                    <DlqActions id={e.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="text-xs text-fg-muted">
        Showing up to 100 most recent entries. Older entries remain in{' '}
        <code className="rounded bg-bg/40 px-1">sync.dead_letter</code> until purged.
      </p>
    </section>
  );
}
