/**
 * Warm-themed left rail for the /memory (“what we know”) surface.
 *
 * Groups the canonical `NodeType`s into friendly category buckets
 * (people / places / things / topics) to match the Claude Design
 * handoff. Each group prints a mono uppercase header and a stack of
 * quiet node links with a sub-line for the fact / alias counts.
 *
 * Server Component. The active type is resolved from the URL by the
 * parent page; the rail itself is presentational.
 */

import Link from 'next/link';


import { NODE_TYPE_LABEL } from './nodeTypeStyles';

import type { NodeListRow } from '@/lib/memory/query';
import type { NodeType } from '@homehub/shared';

import { cn } from '@/lib/cn';

type CategoryKey = 'people' | 'places' | 'things' | 'topics';

interface CategoryMeta {
  id: CategoryKey;
  label: string;
  /** Ordered NodeTypes that belong to this category. */
  types: NodeType[];
}

/**
 * Bucket the shared NODE_TYPES into the four warm categories the
 * design calls for. The enum has more types than the mock — we fold
 * the extras into the closest category rather than invent new ones.
 */
const CATEGORIES: readonly CategoryMeta[] = [
  { id: 'people', label: 'people', types: ['person'] },
  { id: 'places', label: 'places', types: ['place', 'merchant'] },
  {
    id: 'things',
    label: 'things',
    types: ['dish', 'ingredient', 'subscription', 'account'],
  },
  { id: 'topics', label: 'topics', types: ['topic', 'event_type', 'category'] },
];

export interface MemoryCategoryRailProps {
  /** All non-deleted nodes, already sorted pinned-first by the parent. */
  nodes: NodeListRow[];
  /** The active node type (from the URL) — highlights its heading. */
  activeType?: NodeType;
  /** Max nodes to list per category in the rail. */
  perCategoryLimit?: number;
}

export function MemoryCategoryRail({
  nodes,
  activeType,
  perCategoryLimit = 6,
}: MemoryCategoryRailProps) {
  const byType = new Map<string, NodeListRow[]>();
  for (const n of nodes) {
    const list = byType.get(n.type) ?? [];
    list.push(n);
    byType.set(n.type, list);
  }

  return (
    <nav
      aria-label="Memory categories"
      className="flex flex-col gap-6 border-r border-border bg-surface-soft/60 px-5 py-7"
    >
      <div>
        <div className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
          notebook
        </div>
        <div className="text-[15px] font-semibold tracking-[-0.015em] text-fg">What we know</div>
        <p className="mt-1.5 text-[12px] leading-[1.5] text-fg-muted">
          The small things the house has picked up. Correct anything that&apos;s wrong.
        </p>
      </div>

      {CATEGORIES.map((cat) => {
        const catNodes = cat.types.flatMap((t) => byType.get(t) ?? []).slice(0, perCategoryLimit);
        const isActive = !!activeType && cat.types.includes(activeType);

        return (
          <div key={cat.id} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between px-1.5">
              <span
                className={cn(
                  'font-mono text-[10.5px] uppercase tracking-[0.08em]',
                  isActive ? 'text-fg' : 'text-fg-muted',
                )}
              >
                {cat.label}
              </span>
              {cat.types.length === 1 ? (
                <Link
                  href={`/memory/${cat.types[0]}` as never}
                  className="font-mono text-[10px] tracking-[0.04em] text-fg-muted no-underline hover:text-fg"
                >
                  all →
                </Link>
              ) : null}
            </div>

            {catNodes.length === 0 ? (
              <div className="px-1.5 py-1 text-[12px] text-fg-muted italic">nothing yet</div>
            ) : (
              catNodes.map((n) => (
                <Link
                  key={n.id}
                  href={`/memory/${n.type}/${n.id}` as never}
                  className={cn(
                    'group rounded-[3px] px-1.5 py-1.5 no-underline transition-colors',
                    'hover:bg-[rgba(26,26,23,0.04)] focus-visible:bg-[rgba(26,26,23,0.06)]',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  )}
                >
                  <div className="truncate text-[13px] leading-[1.35] text-fg">
                    {n.canonical_name}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10.5px] tracking-[0.04em] text-fg-muted">
                    {NODE_TYPE_LABEL[n.type as NodeType] ?? n.type}
                    {n.fact_count > 0 ? (
                      <>
                        {' '}
                        · {n.fact_count} fact{n.fact_count === 1 ? '' : 's'}
                      </>
                    ) : null}
                  </div>
                </Link>
              ))
            )}
          </div>
        );
      })}
    </nav>
  );
}
