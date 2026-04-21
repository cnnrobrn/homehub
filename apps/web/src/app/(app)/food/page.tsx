/**
 * `/food` — Food segment dashboard.
 *
 * Server Component. Shows the next 7 days meal strip + expiring pantry
 * items + pending suggestions + the latest summary.
 */

import Link from 'next/link';

import { FoodAlertsFeed } from '@/components/food/FoodAlertsFeed';
import { FoodRealtimeRefresher } from '@/components/food/FoodRealtimeRefresher';
import { getHouseholdContext } from '@/lib/auth/context';
import {
  listFoodAlerts,
  listFoodSuggestions,
  listFoodSummaries,
  listMeals,
  listPantryItems,
  type SegmentGrant,
} from '@/lib/food';

function next7Days(): { from: string; to: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

export default async function FoodDashboardPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));

  const { from, to } = next7Days();

  const [meals, pantryExpiring, alerts, suggestions, summaries] = await Promise.all([
    listMeals({ householdId: ctx.household.id, from, to }, { grants }),
    listPantryItems(
      { householdId: ctx.household.id, expiringWithinDays: 3, limit: 20 },
      { grants },
    ),
    listFoodAlerts({ householdId: ctx.household.id, limit: 10 }, { grants }),
    listFoodSuggestions({ householdId: ctx.household.id, limit: 6 }, { grants }),
    listFoodSummaries({ householdId: ctx.household.id, limit: 1 }, { grants }),
  ]);

  const activeAlerts = alerts.filter((a) => a.dismissedAt === null);
  const latestSummary = summaries[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      <FoodRealtimeRefresher householdId={ctx.household.id} />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-xs uppercase tracking-wide text-fg-muted">Latest summary</h2>
          {latestSummary ? (
            <div className="mt-2 flex flex-col gap-1">
              <span className="text-sm font-semibold text-fg">
                {latestSummary.period === 'week' || latestSummary.period === 'weekly'
                  ? 'This week'
                  : 'This month'}
              </span>
              <span className="text-xs text-fg-muted">
                Covers {new Date(latestSummary.coveredStart).toLocaleDateString()} –{' '}
                {new Date(latestSummary.coveredEnd).toLocaleDateString()}
              </span>
              <Link href="/food/summaries" className="mt-2 text-xs text-accent hover:underline">
                Open summaries
              </Link>
            </div>
          ) : (
            <p className="mt-2 text-sm text-fg-muted">No summaries yet — they generate weekly.</p>
          )}
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-xs uppercase tracking-wide text-fg-muted">Pending suggestions</h2>
          {suggestions.length === 0 ? (
            <p className="mt-2 text-sm text-fg-muted">Nothing waiting for review.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2 text-sm">
              {suggestions.slice(0, 3).map((s) => (
                <li key={s.id} className="flex flex-col">
                  <span className="font-medium text-fg">{s.title}</span>
                  <span className="text-xs text-fg-muted">{s.rationale}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="meal-strip-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 id="meal-strip-heading" className="text-lg font-medium">
            Next 7 days
          </h2>
          <Link href="/food/meal-planner" className="text-xs text-accent hover:underline">
            Open planner
          </Link>
        </div>
        {meals.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface p-4 text-sm text-fg-muted">
            No meals planned. Open the planner to draft the week.
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {meals.slice(0, 10).map((m) => (
              <li key={m.id} className="flex items-baseline justify-between gap-2 p-3 text-sm">
                <div className="flex flex-col">
                  <span className="font-medium text-fg">{m.title}</span>
                  <span className="text-xs text-fg-muted">
                    {m.plannedFor} · {m.slot}
                  </span>
                </div>
                <span className="text-xs uppercase text-fg-muted">{m.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pantryExpiring.length > 0 ? (
        <section aria-labelledby="expiring-heading" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 id="expiring-heading" className="text-lg font-medium">
              Expiring soon
            </h2>
            <Link href="/food/pantry" className="text-xs text-accent hover:underline">
              Open pantry
            </Link>
          </div>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {pantryExpiring.map((p) => (
              <li key={p.id} className="flex items-baseline justify-between gap-2 p-3 text-sm">
                <div className="flex flex-col">
                  <span className="font-medium text-fg">{p.name}</span>
                  <span className="text-xs text-fg-muted">
                    {p.location ?? '—'} · {p.quantity ?? '—'} {p.unit ?? ''}
                  </span>
                </div>
                <span className="text-xs text-amber-500">expires {p.expiresOn ?? '—'}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {activeAlerts.length > 0 ? (
        <section aria-labelledby="alerts-heading" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 id="alerts-heading" className="text-lg font-medium">
              Active alerts
            </h2>
            <Link href="/food/alerts" className="text-xs text-accent hover:underline">
              All alerts
            </Link>
          </div>
          <FoodAlertsFeed alerts={activeAlerts} />
        </section>
      ) : null}
    </div>
  );
}
