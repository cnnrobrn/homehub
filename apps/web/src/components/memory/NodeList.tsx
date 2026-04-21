/**
 * Tabular index of memory nodes.
 *
 * Server Component. Used on `/memory` (showing pinned or recent
 * cross-type) and `/memory/[type]`.
 *
 * Sort: pinned first, then `updated_at` desc (the helper already
 * sorts; we render in the order we receive).
 */

import { Pin } from 'lucide-react';
import Link from 'next/link';

import { NODE_TYPE_LABEL } from './nodeTypeStyles';

import type { NodeListRow } from '@/lib/memory/query';
import type { NodeType } from '@homehub/shared';

import { Badge } from '@/components/ui/badge';

export interface NodeListProps {
  nodes: NodeListRow[];
  emptyMessage?: string;
}

export function NodeList({ nodes, emptyMessage = 'No nodes yet.' }: NodeListProps) {
  if (nodes.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-xs uppercase tracking-wide text-fg-muted">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Name</th>
            <th className="px-3 py-2 text-left font-semibold">Type</th>
            <th className="px-3 py-2 text-right font-semibold">Aliases</th>
            <th className="px-3 py-2 text-right font-semibold">Facts</th>
            <th className="px-3 py-2 text-right font-semibold">Updated</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((n) => (
            <tr key={n.id} className="border-b border-border last:border-b-0 hover:bg-bg/40">
              <td className="px-3 py-2">
                <Link
                  href={`/memory/${n.type}/${n.id}` as never}
                  className="flex items-center gap-2 font-medium text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {n.pinned ? <Pin className="h-3 w-3 text-accent" aria-label="Pinned" /> : null}
                  <span className="truncate">{n.canonical_name}</span>
                  {n.needs_review ? (
                    <Badge variant="warn" className="ml-1">
                      Needs review
                    </Badge>
                  ) : null}
                </Link>
              </td>
              <td className="px-3 py-2">
                <span className="text-fg-muted">
                  {NODE_TYPE_LABEL[n.type as NodeType] ?? n.type}
                </span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{n.alias_count}</td>
              <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{n.fact_count}</td>
              <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                {new Date(n.updated_at).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
