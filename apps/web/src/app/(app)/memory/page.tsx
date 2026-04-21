/**
 * `/memory` — graph browser index (M3-D).
 *
 * Server Component. Renders:
 *   - Left rail: node-type navigator.
 *   - Center: search island + empty-state (pinned + recent
 *     episodes) or prompt to search.
 *   - Right rail: conflict feed (facts with
 *     `conflict_status != 'none'`).
 *
 * The search results panel lives inside the client island
 * (`MemorySearch`) — it mutates local state without a URL round
 * trip so the UX feels snappy.
 */

import Link from 'next/link';

import { ConflictBadge } from '@/components/memory/ConflictBadge';
import { MemoryRealtimeRefresher } from '@/components/memory/MemoryRealtimeRefresher';
import { MemorySearch } from '@/components/memory/MemorySearch';
import { NodeList } from '@/components/memory/NodeList';
import { NodeTypeRail } from '@/components/memory/NodeTypeRail';
import { requireHouseholdContext } from '@/lib/auth/context';
import { listNodes, queryHouseholdMemory } from '@/lib/memory/query';

export default async function MemoryPage() {
  const ctx = await requireHouseholdContext();
  const householdId = ctx.household.id;

  // Empty-state content: top pinned / recently-touched nodes + a
  // sampling of recent episodes.
  const [allNodes, recent] = await Promise.all([
    listNodes({ householdId, limit: 25 }),
    queryHouseholdMemory({
      householdId,
      query: 'recent activity',
      layers: ['episodic'],
      limit: 10,
    }),
  ]);

  const pinned = allNodes.filter((n) => n.pinned);
  const conflicts = recent.conflicts.slice(0, 8);

  return (
    <div className="mx-auto flex max-w-7xl gap-6 p-6">
      <MemoryRealtimeRefresher householdId={householdId} />

      <aside className="hidden w-56 shrink-0 lg:block">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Node types
        </h2>
        <NodeTypeRail />
      </aside>

      <section className="flex min-w-0 flex-1 flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Memory</h1>
          <p className="text-sm text-fg-muted">
            Search, browse, and correct what HomeHub remembers about your household.
          </p>
        </header>

        <MemorySearch householdId={householdId} />

        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
            {pinned.length > 0 ? 'Pinned' : 'Recently updated'}
          </h2>
          <NodeList
            nodes={pinned.length > 0 ? pinned : allNodes.slice(0, 10)}
            emptyMessage="Nothing here yet. As integrations sync, nodes will appear."
          />
        </div>

        {recent.episodes.length > 0 ? (
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
              Recent episodes
            </h2>
            <ol className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface">
              {recent.episodes.map((ep) => (
                <li
                  key={ep.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="truncate font-medium">{ep.title}</span>
                  <time className="text-xs text-fg-muted tabular-nums" dateTime={ep.occurred_at}>
                    {new Date(ep.occurred_at).toLocaleDateString()}
                  </time>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </section>

      <aside className="hidden w-72 shrink-0 xl:block">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Needs attention
        </h2>
        {conflicts.length === 0 ? (
          <p className="rounded-md border border-border bg-surface p-3 text-sm text-fg-muted">
            No conflicts right now.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface">
            {conflicts.map((f) => (
              <li key={f.id} className="flex flex-col gap-1 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/memory/person/${f.subject_node_id}` as never}
                    className="truncate font-medium hover:underline"
                  >
                    {f.predicate}
                  </Link>
                  <ConflictBadge status={f.conflict_status} />
                </div>
                <span className="truncate text-xs text-fg-muted">
                  confidence {Math.round(f.confidence * 100)}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
