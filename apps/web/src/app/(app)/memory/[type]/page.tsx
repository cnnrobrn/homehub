/**
 * `/memory/[type]` — node list for a single node type (M3-D).
 *
 * Server Component. Filters `listNodes` to the URL's `[type]` if
 * it matches the canonical node-type enum; otherwise 404s via
 * `notFound()`.
 */

import { NODE_TYPES, type NodeType } from '@homehub/shared';
import { notFound } from 'next/navigation';

import { MemoryRealtimeRefresher } from '@/components/memory/MemoryRealtimeRefresher';
import { NodeList } from '@/components/memory/NodeList';
import { NodeTypeRail } from '@/components/memory/NodeTypeRail';
import { NODE_TYPE_DESCRIPTION, NODE_TYPE_LABEL } from '@/components/memory/nodeTypeStyles';
import { requireHouseholdContext } from '@/lib/auth/context';
import { listNodes } from '@/lib/memory/query';

export interface TypePageProps {
  params: Promise<{ type: string }>;
}

export default async function MemoryTypePage({ params }: TypePageProps) {
  const { type } = await params;
  if (!(NODE_TYPES as readonly string[]).includes(type)) {
    notFound();
  }
  const nodeType = type as NodeType;

  const ctx = await requireHouseholdContext();
  const householdId = ctx.household.id;

  const nodes = await listNodes({
    householdId,
    types: [nodeType],
    limit: 100,
  });

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
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{NODE_TYPE_LABEL[nodeType]}</h1>
          <p className="text-sm text-fg-muted">{NODE_TYPE_DESCRIPTION[nodeType]}</p>
        </header>
        <NodeList
          nodes={nodes}
          emptyMessage={`No ${NODE_TYPE_LABEL[nodeType].toLowerCase()} yet.`}
        />
      </section>
    </div>
  );
}
