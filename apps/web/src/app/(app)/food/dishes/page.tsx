/**
 * `/food/dishes` — dish library backed by `mem.node type='dish'`.
 *
 * Links into the memory graph for edit / ingredient management.
 */

import Link from 'next/link';

import { getHouseholdContext } from '@/lib/auth/context';
import { listDishes, type SegmentGrant } from '@/lib/food';

export default async function DishesPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;
  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));
  const dishes = await listDishes({ householdId: ctx.household.id, limit: 300 }, { grants });
  if (dishes.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
        No dishes yet. The agent populates the dish library from meal history + rememberFact calls.
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {dishes.map((dish) => (
        <li
          key={dish.id}
          className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4"
        >
          <Link
            href={`/memory?node=${encodeURIComponent(dish.id)}` as never}
            className="text-sm font-medium text-fg hover:underline"
          >
            {dish.canonicalName}
          </Link>
          {typeof dish.metadata?.description === 'string' ? (
            <p className="text-xs text-fg-muted">{String(dish.metadata.description)}</p>
          ) : null}
          {Array.isArray(dish.metadata?.tags) ? (
            <div className="flex flex-wrap gap-1 text-xs">
              {(dish.metadata.tags as unknown[]).map((tag, idx) => (
                <span
                  key={`${dish.id}-${idx}`}
                  className="rounded-sm border border-border bg-bg px-1.5 py-0.5 text-fg-muted"
                >
                  {String(tag)}
                </span>
              ))}
            </div>
          ) : null}
          {dish.needsReview ? <span className="text-xs text-amber-500">needs review</span> : null}
        </li>
      ))}
    </ul>
  );
}
