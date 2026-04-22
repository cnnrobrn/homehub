/**
 * `/memory` — "What we know" (warm restyle).
 *
 * Server Component. Renders the Claude Design "V2 Indie" memory
 * surface:
 *
 *  - Left rail: notebook header + bucketed list of people / places /
 *    things / topics — the friendly framing of the underlying
 *    NodeTypes.
 *  - Middle: a stream of recently-picked-up facts and episodes shown
 *    as subtle cards with mono timestamps and middot-separated meta.
 *  - Bottom: a calm "how this works" note explaining that anything
 *    wrong can be corrected, and the old version is kept quietly.
 *
 * The underlying queries (listNodes / queryHouseholdMemory) are
 * unchanged — only the presentation has been reshaped.
 */

import { PageHeader, NoteCallout } from '@/components/design-system';
import { FactStream, type StreamEntry } from '@/components/memory/FactStream';
import { MemoryCategoryRail } from '@/components/memory/MemoryCategoryRail';
import { MemoryRealtimeRefresher } from '@/components/memory/MemoryRealtimeRefresher';
import { MemorySearch } from '@/components/memory/MemorySearch';
import { requireHouseholdContext } from '@/lib/auth/context';
import { listNodes, queryHouseholdMemory, type NodeRow } from '@/lib/memory/query';

export default async function MemoryPage() {
  const ctx = await requireHouseholdContext();
  const householdId = ctx.household.id;

  // Pull a broad slice of nodes for the category rail + lookup, and
  // the recent episodic layer for the stream. Both calls already
  // scope by household.
  const [allNodes, recent] = await Promise.all([
    listNodes({ householdId, limit: 100 }),
    queryHouseholdMemory({
      householdId,
      query: 'recent activity',
      layers: ['episodic', 'semantic'],
      limit: 40,
    }),
  ]);

  // Build a name lookup once for the stream (subject / object / place).
  const nodeLookup = new Map<string, NodeRow>();
  for (const n of allNodes) nodeLookup.set(n.id, n);
  for (const n of recent.nodes) nodeLookup.set(n.id, n);

  // Merge facts + episodes into a single time-ordered stream.
  const entries: StreamEntry[] = [
    ...recent.facts.map((fact) => ({ kind: 'fact' as const, fact })),
    ...recent.episodes.map((episode) => ({ kind: 'episode' as const, episode })),
  ]
    .sort((a, b) => {
      const at = a.kind === 'fact' ? a.fact.recorded_at : a.episode.occurred_at;
      const bt = b.kind === 'fact' ? b.fact.recorded_at : b.episode.occurred_at;
      return Date.parse(bt) - Date.parse(at);
    })
    .slice(0, 18);

  const pickedUpCount = entries.length;

  return (
    <div className="grid min-h-full grid-cols-1 lg:grid-cols-[260px_1fr]">
      <MemoryRealtimeRefresher householdId={householdId} />

      <aside className="hidden lg:block">
        <MemoryCategoryRail nodes={allNodes} />
      </aside>

      <section className="mx-auto w-full max-w-[760px] px-8 pt-10 pb-20 lg:px-12">
        <PageHeader
          eyebrow={<>what we know · {allNodes.length} entries</>}
          title={<>Here&apos;s what I&apos;ve picked up.</>}
          sub={
            pickedUpCount > 0
              ? "Small things the house noticed from your calendar, receipts, and notes. If anything's off, you can fix it — the old version stays around quietly."
              : 'Nothing yet. As integrations sync — calendar, email, receipts — small facts will land here.'
          }
        />

        <div className="mb-8">
          <MemorySearch householdId={householdId} />
        </div>

        <div className="mb-3 flex items-baseline gap-2.5">
          <h2 className="m-0 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-fg">
            recently picked up
          </h2>
          {pickedUpCount > 0 ? (
            <span className="font-mono text-[10.5px] tracking-[0.04em] text-fg-muted">
              · {pickedUpCount} notes
            </span>
          ) : null}
        </div>

        <FactStream entries={entries} nodeLookup={nodeLookup} />

        <div className="mt-10">
          <NoteCallout>
            <div className="text-fg">
              Anything here look wrong? You can fix it, and the house will remember the correction.
              The old version is kept quietly, just in case.
            </div>
            <div className="mt-2 font-mono text-[11px] tracking-[0.04em] text-fg-muted">
              ask about anything here — i&apos;ll point at the fact.
            </div>
          </NoteCallout>
        </div>
      </section>
    </div>
  );
}
