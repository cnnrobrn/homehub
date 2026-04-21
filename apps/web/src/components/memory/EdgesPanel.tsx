/**
 * Outgoing + incoming edges grouped by edge-type.
 *
 * Server Component. Edges are node-to-node; we render a table
 * per edge-type with links to the neighbor node.
 */

import Link from 'next/link';

import type { EdgeRow, NodeRow } from '@/lib/memory/query';

export interface EdgesPanelProps {
  focusNodeId: string;
  edges: EdgeRow[];
  nodeLookup: Map<string, NodeRow>;
}

export function EdgesPanel({ focusNodeId, edges, nodeLookup }: EdgesPanelProps) {
  if (edges.length === 0) {
    return (
      <p className="rounded-md border border-border bg-surface p-4 text-sm text-fg-muted">
        No edges from this node yet.
      </p>
    );
  }

  const grouped = new Map<string, EdgeRow[]>();
  for (const e of edges) {
    const list = grouped.get(e.type) ?? [];
    list.push(e);
    grouped.set(e.type, list);
  }

  return (
    <div className="flex flex-col gap-4">
      {Array.from(grouped.entries()).map(([type, list]) => (
        <section
          key={type}
          className="overflow-hidden rounded-md border border-border bg-surface"
          aria-label={`Edges of type ${type}`}
        >
          <header className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            {type}
            <span className="ml-2 font-normal normal-case text-fg-muted">({list.length})</span>
          </header>
          <ul className="divide-y divide-border">
            {list.map((edge) => {
              const neighborId = edge.src_id === focusNodeId ? edge.dst_id : edge.src_id;
              const direction = edge.src_id === focusNodeId ? 'outgoing' : 'incoming';
              const neighbor = nodeLookup.get(neighborId);
              const href = neighbor ? `/memory/${neighbor.type}/${neighbor.id}` : null;
              return (
                <li
                  key={edge.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <div className="flex min-w-0 flex-col">
                    {href ? (
                      <Link href={href as never} className="truncate font-medium hover:underline">
                        {neighbor?.canonical_name ?? neighborId.slice(0, 8)}
                      </Link>
                    ) : (
                      <span className="truncate font-medium text-fg-muted">
                        {neighborId.slice(0, 8)}
                      </span>
                    )}
                    <span className="text-xs text-fg-muted">{direction}</span>
                  </div>
                  <span className="text-xs text-fg-muted">weight {edge.weight}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
