/**
 * `/social` — Social segment dashboard.
 */

import Link from 'next/link';

import { BirthdayCountdown } from '@/components/social/BirthdayCountdown';
import { SocialRealtimeRefresher } from '@/components/social/SocialRealtimeRefresher';
import { getHouseholdContext } from '@/lib/auth/context';
import { listEvents } from '@/lib/events/listEvents';
import {
  listSocialAlerts,
  listSocialSuggestions,
  listSocialSummaries,
  type SegmentGrant,
} from '@/lib/social';

const UPCOMING_WINDOW_DAYS = 30;

export default async function SocialDashboardPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));
  const eventsGrants = ctx.grants.map((g) => ({
    segment: g.segment as 'financial' | 'food' | 'fun' | 'social' | 'system',
    access: g.access,
  }));

  const now = new Date();
  const horizon = new Date(now.getTime() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [alerts, suggestions, summaries, events] = await Promise.all([
    listSocialAlerts({ householdId: ctx.household.id, limit: 20 }, { grants }),
    listSocialSuggestions({ householdId: ctx.household.id, limit: 5 }, { grants }),
    listSocialSummaries({ householdId: ctx.household.id, limit: 2 }, { grants }),
    listEvents(
      {
        householdId: ctx.household.id,
        from: now.toISOString(),
        to: horizon.toISOString(),
        segments: ['social'],
      },
      { grants: eventsGrants },
    ),
  ]);

  const birthdays = events.filter((e) => e.kind === 'birthday');
  const latestSummary = summaries[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      <SocialRealtimeRefresher householdId={ctx.household.id} />

      <section aria-labelledby="latest-heading" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 id="latest-heading" className="text-xs uppercase tracking-wide text-fg-muted">
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
              <Link href="/social/summaries" className="mt-2 text-xs text-accent hover:underline">
                Open summaries
              </Link>
            </div>
          ) : (
            <p className="mt-2 text-sm text-fg-muted">
              No summaries yet. They generate weekly after the first sync completes.
            </p>
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

      <section aria-labelledby="birthdays-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 id="birthdays-heading" className="text-lg font-medium">
            Upcoming birthdays (next 30 days)
          </h2>
          <Link href="/social/calendar" className="text-xs text-accent hover:underline">
            Full calendar
          </Link>
        </div>
        {birthdays.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface p-4 text-sm text-fg-muted">
            Nothing on the horizon.
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {birthdays.slice(0, 8).map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <span className="font-medium text-fg">{e.title}</span>
                <BirthdayCountdown startsAt={e.startsAt} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {alerts.length > 0 ? (
        <section aria-labelledby="alerts-heading" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 id="alerts-heading" className="text-lg font-medium">
              Active alerts
            </h2>
            <Link href="/social/alerts" className="text-xs text-accent hover:underline">
              All alerts
            </Link>
          </div>
          <ul role="list" className="flex flex-col gap-2">
            {alerts.slice(0, 5).map((a) => (
              <li key={a.id} className="rounded-lg border border-border bg-surface p-4 text-sm">
                <h3 className="font-semibold text-fg">{a.title}</h3>
                <p className="text-fg-muted">{a.body}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
