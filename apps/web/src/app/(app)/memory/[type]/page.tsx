/**
 * `/memory/[type]` — node list for a single NodeType (warm restyle).
 *
 * Server Component. Filters `listNodes` to the URL's `[type]` if
 * it matches the canonical node-type enum; otherwise 404s via
 * `notFound()`.
 *
 * Layout mirrors the /memory index: left category rail + centered
 * stream of nodes as subtle cards with mono meta (fact count,
 * last-updated, pinned + needs-review pills).
 */

import { NODE_TYPES, type NodeType } from '@homehub/shared';
import { Pin } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageHeader, NoteCallout } from '@/components/design-system';
import { MemoryCategoryRail } from '@/components/memory/MemoryCategoryRail';
import { MemoryRealtimeRefresher } from '@/components/memory/MemoryRealtimeRefresher';
import { NODE_TYPE_DESCRIPTION, NODE_TYPE_LABEL } from '@/components/memory/nodeTypeStyles';
import { requireHouseholdContext } from '@/lib/auth/context';
import { listNodes, type NodeListRow } from '@/lib/memory/query';

export interface TypePageProps {
  params: Promise<{ type: string }>;
}

function friendlyLabel(label: string): string {
  return label.toLowerCase();
}

function shortDate(iso: string): string {
  return new Date(iso)
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    .toLowerCase();
}

export default async function MemoryTypePage({ params }: TypePageProps) {
  const { type } = await params;
  if (!(NODE_TYPES as readonly string[]).includes(type)) {
    notFound();
  }
  const nodeType = type as NodeType;

  const ctx = await requireHouseholdContext();
  const householdId = ctx.household.id;

  // Rail needs a broader slice so every category has something to show;
  // the type-scoped list is used for the main stream.
  const [allNodes, nodes] = await Promise.all([
    listNodes({ householdId, limit: 100 }),
    listNodes({ householdId, types: [nodeType], limit: 100 }),
  ]);

  const label = NODE_TYPE_LABEL[nodeType];

  return (
    <div className="grid min-h-full grid-cols-1 lg:grid-cols-[260px_1fr]">
      <MemoryRealtimeRefresher householdId={householdId} />

      <aside className="hidden lg:block">
        <MemoryCategoryRail nodes={allNodes} activeType={nodeType} />
      </aside>

      <section className="mx-auto w-full max-w-[760px] px-8 pt-10 pb-20 lg:px-12">
        <PageHeader
          eyebrow={<>what we know · {friendlyLabel(label)}</>}
          title={<>{label}</>}
          sub={NODE_TYPE_DESCRIPTION[nodeType]}
        />

        {nodes.length === 0 ? (
          <NoteCallout>
            <div className="text-fg">
              Nothing here yet. Once the house picks up a {friendlyLabel(label)}, it&apos;ll land in
              this list quietly.
            </div>
          </NoteCallout>
        ) : (
          <div className="flex flex-col gap-2.5">
            {nodes.map((n) => (
              <NodeStreamCard key={n.id} node={n} />
            ))}
          </div>
        )}

        <div className="mt-10 font-mono text-[11px] tracking-[0.04em] text-fg-muted">
          {nodes.length} {nodes.length === 1 ? 'entry' : 'entries'} · tap any one to see the little
          things we&apos;ve noted.
        </div>
      </section>
    </div>
  );
}

function NodeStreamCard({ node }: { node: NodeListRow }) {
  return (
    <Link
      href={`/memory/${node.type}/${node.id}` as never}
      className="block rounded-[6px] border border-border bg-surface px-[18px] py-3.5 no-underline shadow-[0_8px_24px_-8px_rgba(0,0,0,0.06)] transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      <div className="mb-1.5 flex items-baseline gap-2.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
        <span>updated {shortDate(node.updated_at)}</span>
        {node.fact_count > 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <span>
              {node.fact_count} fact{node.fact_count === 1 ? '' : 's'}
            </span>
          </>
        ) : null}
        {node.alias_count > 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <span>
              {node.alias_count} {node.alias_count === 1 ? 'alias' : 'aliases'}
            </span>
          </>
        ) : null}
        {node.pinned ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1 text-accent">
              <Pin className="h-3 w-3" aria-label="Pinned" />
              <span>pinned</span>
            </span>
          </>
        ) : null}
        {node.needs_review ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="text-warn">needs review</span>
          </>
        ) : null}
      </div>
      <div className="text-[14px] font-medium leading-[1.35] text-fg">{node.canonical_name}</div>
    </Link>
  );
}
