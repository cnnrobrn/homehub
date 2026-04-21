/**
 * Left-rail navigator listing every node type.
 *
 * Server Component. The active type is passed in from the page
 * (it reads from the URL). Counts come pre-aggregated from the
 * parent so this component stays dumb.
 */

import Link from 'next/link';

import { NODE_TYPES_ORDERED, NODE_TYPE_LABEL } from './nodeTypeStyles';

import { cn } from '@/lib/cn';

export interface NodeTypeRailProps {
  activeType?: string;
  /** Map of node-type → count. Keys missing render without a count badge. */
  counts?: Record<string, number>;
}

export function NodeTypeRail({ activeType, counts }: NodeTypeRailProps) {
  return (
    <nav aria-label="Memory node types" className="flex flex-col gap-1">
      <Link
        href={'/memory' as never}
        className={cn(
          'rounded-md px-2 py-1 text-sm hover:bg-bg/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          !activeType && 'bg-surface font-medium',
        )}
      >
        Everything
      </Link>
      {NODE_TYPES_ORDERED.map((t) => (
        <Link
          key={t}
          href={`/memory/${t}` as never}
          className={cn(
            'flex items-center justify-between rounded-md px-2 py-1 text-sm hover:bg-bg/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            activeType === t && 'bg-surface font-medium',
          )}
        >
          <span>{NODE_TYPE_LABEL[t]}</span>
          {counts && counts[t] !== undefined ? (
            <span className="text-xs tabular-nums text-fg-muted">{counts[t]}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
