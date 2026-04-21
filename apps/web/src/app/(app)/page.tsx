/**
 * `/` — Dashboard (authenticated).
 *
 * M2-C adds a real Today strip: horizontal list of today's events pulled
 * via `listEvents()`. The segment cards below remain disabled
 * placeholders for now — they come alive in M3+ as each segment's
 * workers / summaries ship.
 *
 * The realtime refresher keeps the Today strip current when the
 * sync-gcal worker upserts events without a page reload.
 */

import { CircleDollarSign, PartyPopper, Users, Utensils } from 'lucide-react';
import Link from 'next/link';

import { listMembersAction } from '@/app/actions/members';
import { EventPill } from '@/components/calendar/EventPill';
import { RealtimeEventRefresher } from '@/components/calendar/RealtimeEventRefresher';
import { SegmentCard } from '@/components/dashboard/SegmentCard';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getHouseholdContext } from '@/lib/auth/context';
import { listEvents, type Segment } from '@/lib/events/listEvents';
import { endOfToday, startOfToday } from '@/lib/events/range';

const TODAY_STRIP_LIMIT = 10;

export default async function DashboardPage() {
  const ctx = await getHouseholdContext();
  // Layout already redirected if ctx was null; this is just a type guard.
  if (!ctx) return null;

  const membersRes = await listMembersAction({ householdId: ctx.household.id });
  const memberCount = membersRes.ok ? membersRes.data.length : 0;

  const grants = ctx.grants.map((g) => ({ segment: g.segment as Segment, access: g.access }));
  const from = startOfToday();
  const to = endOfToday();
  const todayEvents = (
    await listEvents(
      {
        householdId: ctx.household.id,
        from: from.toISOString(),
        to: to.toISOString(),
        limit: TODAY_STRIP_LIMIT,
      },
      { grants },
    )
  ).slice(0, TODAY_STRIP_LIMIT);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6">
      <RealtimeEventRefresher householdId={ctx.household.id} />

      <header className="flex flex-col gap-2">
        <p className="text-sm text-fg-muted">Household</p>
        <h1 className="text-3xl font-semibold tracking-tight">{ctx.household.name}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          <Badge variant="outline">{ctx.member.role}</Badge>
          <span>·</span>
          <span>
            {memberCount} {memberCount === 1 ? 'member' : 'members'}
          </span>
        </div>
      </header>

      <section aria-labelledby="today-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 id="today-heading" className="text-lg font-medium">
            Today
          </h2>
          <Link href="/calendar" className="text-xs text-accent underline-offset-2 hover:underline">
            Open calendar
          </Link>
        </div>
        {todayEvents.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">No events today.</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-fg-muted">
                When events land on today&apos;s date they&apos;ll show up here. Visit the{' '}
                <Link
                  href="/calendar"
                  className="text-accent underline underline-offset-2 hover:no-underline"
                >
                  calendar
                </Link>{' '}
                for the full week.
              </p>
            </CardContent>
          </Card>
        ) : (
          <ul aria-label="Today's events" className="flex gap-2 overflow-x-auto pb-2">
            {todayEvents.map((ev) => (
              <li key={ev.id} className="min-w-[220px] max-w-[260px] shrink-0">
                <Link
                  href={`/calendar?view=week&cursor=today#event-${ev.id}`}
                  className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                >
                  <EventPill event={ev} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="segments-heading" className="flex flex-col gap-3">
        <h2 id="segments-heading" className="text-lg font-medium">
          Segments
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SegmentCard
            label="Financial"
            description="Budgets, accounts, subscriptions"
            icon={<CircleDollarSign className="h-5 w-5" aria-hidden="true" />}
          />
          <SegmentCard
            label="Food"
            description="Meal planner, pantry, groceries"
            icon={<Utensils className="h-5 w-5" aria-hidden="true" />}
          />
          <SegmentCard
            label="Fun"
            description="Trips, queue, plans"
            icon={<PartyPopper className="h-5 w-5" aria-hidden="true" />}
          />
          <SegmentCard
            label="Social"
            description="People, contacts, events"
            icon={<Users className="h-5 w-5" aria-hidden="true" />}
          />
        </div>
      </section>
    </div>
  );
}
