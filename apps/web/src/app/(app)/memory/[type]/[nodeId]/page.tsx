/**
 * `/memory/[type]/[nodeId]` — node detail page (warm restyle shell).
 *
 * Server Component. Loads the node + its facts / episodes / edges
 * in one round-trip and renders the four-tab layout:
 *   - Document: `document_md` markdown + editable `manual_notes_md`.
 *   - Facts: atomic facts with per-row affordances.
 *   - Episodes: time-ordered episodes.
 *   - Edges: outgoing edges grouped by edge-type.
 *
 * The surrounding chrome — left category rail, warm header, page
 * padding — matches the /memory index. The panel bodies themselves
 * keep their existing affordances intact; restyling them fully is
 * a follow-up outside the "What we know" reshape scope.
 */

import { NODE_TYPES, type NodeType } from '@homehub/shared';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/design-system';
import { EdgesPanel } from '@/components/memory/EdgesPanel';
import { EpisodesPanel } from '@/components/memory/EpisodesPanel';
import { FactsPanel } from '@/components/memory/FactsPanel';
import { ManualNotesEditor } from '@/components/memory/ManualNotesEditor';
import { MemoryCategoryRail } from '@/components/memory/MemoryCategoryRail';
import { MemoryRealtimeRefresher } from '@/components/memory/MemoryRealtimeRefresher';
import { NeedsReviewToggle } from '@/components/memory/NeedsReviewToggle';
import { NodeOwnerMenu } from '@/components/memory/NodeOwnerMenu';
import { NODE_TYPE_LABEL } from '@/components/memory/nodeTypeStyles';
import { PinButton } from '@/components/memory/PinButton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { requireHouseholdContext } from '@/lib/auth/context';
import { getNode, listNodes, type NodeRow } from '@/lib/memory/query';

export interface NodeDetailPageProps {
  params: Promise<{ type: string; nodeId: string }>;
}

function shortWhen(iso: string): string {
  return new Date(iso)
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    .toLowerCase();
}

export default async function MemoryNodeDetailPage({ params }: NodeDetailPageProps) {
  const { type, nodeId } = await params;
  if (!(NODE_TYPES as readonly string[]).includes(type)) {
    notFound();
  }
  const nodeType = type as NodeType;

  const ctx = await requireHouseholdContext();
  const householdId = ctx.household.id;
  const memberId = ctx.member.id;
  const isOwner = ctx.member.role === 'owner';

  const [detail, railNodes] = await Promise.all([
    getNode({ householdId, nodeId }),
    listNodes({ householdId, limit: 100 }),
  ]);
  if (!detail || detail.node.type !== nodeType) {
    notFound();
  }

  // Resolve neighbor node labels for the edges panel + object refs
  // in facts. One round-trip for every unique referenced node id.
  const neighborIds = new Set<string>();
  for (const e of detail.edges) {
    neighborIds.add(e.src_id);
    neighborIds.add(e.dst_id);
  }
  for (const f of detail.facts) {
    if (f.object_node_id) neighborIds.add(f.object_node_id);
  }
  neighborIds.delete(nodeId);

  const nodeLookup = new Map<string, NodeRow>();
  for (const n of railNodes) {
    if (neighborIds.has(n.id)) nodeLookup.set(n.id, n);
  }
  // Any still-missing neighbors: one extra fetch to resolve them.
  const missing = Array.from(neighborIds).filter((id) => !nodeLookup.has(id));
  if (missing.length > 0) {
    const extra = await listNodes({
      householdId,
      limit: Math.max(100, missing.length + 10),
    });
    for (const n of extra) {
      if (neighborIds.has(n.id)) nodeLookup.set(n.id, n);
    }
  }

  // Merge candidates for owner-only menu: same type, different
  // node, not soft-deleted. listNodes already hides soft-deleted.
  const mergeCandidates = isOwner
    ? (
        await listNodes({
          householdId,
          types: [nodeType],
          limit: 200,
        })
      )
        .filter((n) => n.id !== nodeId)
        .map((n) => ({ id: n.id, canonical_name: n.canonical_name }))
    : [];

  const meta = (detail.node.metadata ?? {}) as Record<string, unknown>;
  const pinnedList = Array.isArray(meta['pinned_by_member_ids'])
    ? (meta['pinned_by_member_ids'] as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  const pinned = pinnedList.includes(memberId);

  return (
    <div className="grid min-h-full grid-cols-1 lg:grid-cols-[260px_1fr]">
      <MemoryRealtimeRefresher householdId={householdId} />

      <aside className="hidden lg:block">
        <MemoryCategoryRail nodes={railNodes} activeType={nodeType} />
      </aside>

      <section className="mx-auto w-full max-w-[760px] px-8 pt-10 pb-20 lg:px-12">
        <PageHeader
          eyebrow={
            <>
              {NODE_TYPE_LABEL[nodeType].toLowerCase()} · noted {shortWhen(detail.node.updated_at)}
            </>
          }
          title={<>{detail.node.canonical_name}</>}
          sub={
            detail.node.needs_review
              ? "Flagged for a second look — something here didn't line up."
              : undefined
          }
        />

        <div className="mb-7 -mt-4 flex flex-wrap items-center gap-2">
          <PinButton nodeId={detail.node.id} initialPinned={pinned} />
          <NeedsReviewToggle nodeId={detail.node.id} initialValue={detail.node.needs_review} />
          {isOwner ? (
            <NodeOwnerMenu
              nodeId={detail.node.id}
              nodeLabel={detail.node.canonical_name}
              mergeCandidates={mergeCandidates}
            />
          ) : null}
        </div>

        <Tabs defaultValue="facts" className="flex min-w-0 flex-col">
          <TabsList>
            <TabsTrigger value="facts">Facts ({detail.facts.length})</TabsTrigger>
            <TabsTrigger value="episodes">Episodes ({detail.episodes.length})</TabsTrigger>
            <TabsTrigger value="edges">Edges ({detail.edges.length})</TabsTrigger>
            <TabsTrigger value="document">Notes</TabsTrigger>
          </TabsList>

          <TabsContent value="facts">
            <FactsPanel
              subjectLabel={detail.node.canonical_name}
              facts={detail.facts}
              nodeLookup={nodeLookup}
            />
          </TabsContent>

          <TabsContent value="episodes">
            <EpisodesPanel episodes={detail.episodes} />
          </TabsContent>

          <TabsContent value="edges">
            <EdgesPanel focusNodeId={detail.node.id} edges={detail.edges} nodeLookup={nodeLookup} />
          </TabsContent>

          <TabsContent value="document" className="flex flex-col gap-6">
            {detail.node.document_md ? (
              <article className="rounded-[6px] border border-border bg-surface p-4 text-[13.5px] leading-[1.6] shadow-[0_8px_24px_-8px_rgba(0,0,0,0.06)]">
                <pre className="whitespace-pre-wrap font-sans">{detail.node.document_md}</pre>
              </article>
            ) : (
              <p className="rounded-[6px] border border-border bg-surface p-4 text-[13.5px] text-fg-muted">
                No canonical document yet. Consolidation will generate one as more data arrives.
              </p>
            )}
            <ManualNotesEditor
              nodeId={detail.node.id}
              initialMarkdown={detail.node.manual_notes_md}
            />
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}
