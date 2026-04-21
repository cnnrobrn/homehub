/**
 * `/fun` — Fun segment dashboard.
 *
 * Server Component. Pulls upcoming trips, the latest summary, pending
 * suggestions, and active alerts. The layout already gates on
 * `fun:read`; this page assumes access.
 */

import Link from 'next/link';

import { FunRealtimeRefresher } from '@/components/fun/FunRealtimeRefresher';
import { OutingSuggestionCard } from '@/components/fun/OutingSuggestionCard';
import { TripList } from '@/components/fun/TripList';
import { getHouseholdContext } from '@/lib/auth/context';
import {
  listFunAlerts,
  listFunSuggestions,
  listFunSummaries,
  listTrips,
  type SegmentGrant,
} from '@/lib/fun';

export default async function FunDashboardPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));

  const [trips, alerts, suggestions, summaries] = await Promise.all([
    listTrips({ householdId: ctx.household.id, limit: 5 }, { grants }),
    listFunAlerts({ householdId: ctx.household.id, limit: 10 }, { grants }),
    listFunSuggestions({ householdId: ctx.household.id, limit: 5 }, { grants }),
    listFunSummaries({ householdId: ctx.household.id, limit: 1 }, { grants }),
  ]);

  const activeAlerts = alerts.filter(
    (a) => a.dismissedAt === null && (a.severity === 'critical' || a.severity === 'warn'),
  );
  const latestSummary = summaries[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      <FunRealtimeRefresher householdId={ctx.household.id} />

      <section aria-labelledby="summary-heading" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 id="summary-heading" className="text-xs uppercase tracking-wide text-fg-muted">
            Latest summary
          </h2>
          {latestSummary ? (
            <div className="mt-2 flex flex-col gap-1">
              <span className="text-sm font-semibold text-fg">
                {latestSummary.period === 'weekly' ? 'This week' : 'This month'}
              </span>
              <span className="text-xs text-fg-muted">
                Covers {new Date(latestSummary.coveredStart).toLocaleDateString()} –{' '}
                {new Date(latestSummary.coveredEnd).toLocaleDateString()}
              </span>
              <Link href="/fun/summaries" className="mt-2 text-xs text-accent hover:underline">
                Open summaries
              </Link>
            </div>
          ) : (
            <p className="mt-2 text-sm text-fg-muted">
              No fun summaries yet. They generate weekly after the first fun events land.
            </p>
          )}
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-xs uppercase tracking-wide text-fg-muted">Pending suggestions</h2>
          {suggestions.length === 0 ? (
            <p className="mt-2 text-sm text-fg-muted">Nothing waiting for review.</p>
          ) : (
            <p className="mt-2 text-sm text-fg-muted">
              {suggestions.length} suggestion(s) ready. See below.
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby="trips-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 id="trips-heading" className="text-lg font-medium">
            Upcoming trips
          </h2>
          <Link href="/fun/trips" className="text-xs text-accent hover:underline">
            All trips
          </Link>
        </div>
        <TripList trips={trips} />
      </section>

      {suggestions.length > 0 ? (
        <section aria-labelledby="suggestions-heading" className="flex flex-col gap-3">
          <h2 id="suggestions-heading" className="text-lg font-medium">
            Suggestions
          </h2>
          <div className="flex flex-col gap-3">
            {suggestions.map((s) => (
              <OutingSuggestionCard key={s.id} suggestion={s} />
            ))}
          </div>
        </section>
      ) : null}

      {activeAlerts.length > 0 ? (
        <section aria-labelledby="alerts-heading" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 id="alerts-heading" className="text-lg font-medium">
              Active alerts
            </h2>
            <Link href="/fun/alerts" className="text-xs text-accent hover:underline">
              All alerts
            </Link>
          </div>
          <ul className="flex flex-col gap-2">
            {activeAlerts.slice(0, 5).map((a) => (
              <li key={a.id} className="rounded-lg border border-border bg-surface p-3 text-sm">
                <span className="font-medium text-fg">{a.title}</span>
                <span className="ml-2 text-xs uppercase tracking-wide text-fg-muted">
                  {a.severity}
                </span>
                <p className="mt-1 text-xs text-fg-muted">{a.body}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
