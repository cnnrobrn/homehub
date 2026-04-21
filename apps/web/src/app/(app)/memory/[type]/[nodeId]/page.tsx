/**
 * `/memory/[type]/[nodeId]` — node detail page (M3-D).
 *
 * Server Component. Loads the node + its facts / episodes / edges
 * in one round-trip and renders the four-tab layout from
 * `specs/07-frontend/pages.md`.
 *
 * Tabs:
 *   - Document: `document_md` markdown + editable `manual_notes_md`.
 *   - Facts: atomic facts with per-row affordances.
 *   - Episodes: time-ordered episodes.
 *   - Edges: outgoing edges grouped by edge-type.
 *
 * Owner-only actions (Merge, Delete) are rendered next to the
 * header; merge candidates are pre-resolved (same type, different
 * node, same household) server-side.
 */

import { NODE_TYPES, type NodeType } from '@homehub/shared';
import { notFound } from 'next/navigation';

import { EdgesPanel } from '@/components/memory/EdgesPanel';
import { EpisodesPanel } from '@/components/memory/EpisodesPanel';
import { FactsPanel } from '@/components/memory/FactsPanel';
import { ManualNotesEditor } from '@/components/memory/ManualNotesEditor';
import { MemoryRealtimeRefresher } from '@/components/memory/MemoryRealtimeRefresher';
import { NeedsReviewToggle } from '@/components/memory/NeedsReviewToggle';
import { NodeHeader } from '@/components/memory/NodeHeader';
import { NodeOwnerMenu } from '@/components/memory/NodeOwnerMenu';
import { NodeTypeRail } from '@/components/memory/NodeTypeRail';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { requireHouseholdContext } from '@/lib/auth/context';
import { getNode, listNodes, type NodeRow } from '@/lib/memory/query';

export interface NodeDetailPageProps {
  params: Promise<{ type: string; nodeId: string }>;
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

  const detail = await getNode({ householdId, nodeId });
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
  if (neighborIds.size > 0) {
    // Use `listNodes` without type filter to resolve any referenced node.
    const neighbors = await listNodes({
      householdId,
      limit: Math.max(100, neighborIds.size + 10),
    });
    for (const n of neighbors) {
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
    <div className="mx-auto flex max-w-7xl gap-6 p-6">
      <MemoryRealtimeRefresher householdId={householdId} />

      <aside className="hidden w-56 shrink-0 lg:block">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Node types
        </h2>
        <NodeTypeRail activeType={nodeType} />
      </aside>

      <section className="flex min-w-0 flex-1 flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <NodeHeader node={detail.node} pinned={pinned} />
          <div className="flex items-center gap-2">
            <NeedsReviewToggle nodeId={detail.node.id} initialValue={detail.node.needs_review} />
            {isOwner ? (
              <NodeOwnerMenu
                nodeId={detail.node.id}
                nodeLabel={detail.node.canonical_name}
                mergeCandidates={mergeCandidates}
              />
            ) : null}
          </div>
        </div>

        <Tabs defaultValue="document" className="flex min-w-0 flex-col">
          <TabsList>
            <TabsTrigger value="document">Document</TabsTrigger>
            <TabsTrigger value="facts">Facts ({detail.facts.length})</TabsTrigger>
            <TabsTrigger value="episodes">Episodes ({detail.episodes.length})</TabsTrigger>
            <TabsTrigger value="edges">Edges ({detail.edges.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="document" className="flex flex-col gap-6">
            {detail.node.document_md ? (
              <article className="rounded-md border border-border bg-surface p-4 text-sm leading-6">
                <pre className="whitespace-pre-wrap font-sans">{detail.node.document_md}</pre>
              </article>
            ) : (
              <p className="rounded-md border border-border bg-surface p-4 text-sm text-fg-muted">
                No canonical document yet. Consolidation will generate one as more data arrives.
              </p>
            )}
            <ManualNotesEditor
              nodeId={detail.node.id}
              initialMarkdown={detail.node.manual_notes_md}
            />
          </TabsContent>

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
        </Tabs>
      </section>
    </div>
  );
}
