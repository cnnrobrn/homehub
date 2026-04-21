/**
 * `/social/calendar` — social-segment-only calendar view.
 */

import Link from 'next/link';

import { CalendarNav } from '@/components/calendar/CalendarNav';
import { MonthGrid } from '@/components/calendar/MonthGrid';
import { ViewToggle } from '@/components/calendar/ViewToggle';
import { WeekGrid } from '@/components/calendar/WeekGrid';
import { SocialRealtimeRefresher } from '@/components/social/SocialRealtimeRefresher';
import { getHouseholdContext } from '@/lib/auth/context';
import { listEvents } from '@/lib/events/listEvents';
import {
  calendarWindow,
  formatISODate,
  parseCursor,
  parseView,
  parseWeekStart,
} from '@/lib/events/range';

export interface SocialCalendarPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function titleFor(view: 'week' | 'month', from: Date, to: Date): string {
  if (view === 'month') {
    return from.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  const sameMonth = from.getMonth() === to.getMonth();
  const fromLabel = from.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const toLabel = sameMonth
    ? to.toLocaleDateString(undefined, { day: 'numeric', year: 'numeric' })
    : to.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fromLabel} – ${toLabel}`;
}

export default async function SocialCalendarPage({ searchParams }: SocialCalendarPageProps) {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const params = await searchParams;
  const view = parseView(typeof params.view === 'string' ? params.view : undefined);
  const cursor = parseCursor(typeof params.cursor === 'string' ? params.cursor : undefined);

  const settings = (ctx.household.settings as { week_start?: unknown }) ?? {};
  const weekStart = parseWeekStart(settings.week_start);
  const { from, to } = calendarWindow(view, cursor, weekStart);

  const eventsGrants = ctx.grants.map((g) => ({
    segment: g.segment as 'financial' | 'food' | 'fun' | 'social' | 'system',
    access: g.access,
  }));

  const events = await listEvents(
    {
      householdId: ctx.household.id,
      from: from.toISOString(),
      to: to.toISOString(),
      segments: ['social'],
    },
    { grants: eventsGrants },
  );

  return (
    <div className="flex flex-col gap-4">
      <SocialRealtimeRefresher householdId={ctx.household.id} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CalendarNav view={view} cursor={formatISODate(cursor)} title={titleFor(view, from, to)} />
        <div className="flex flex-wrap items-center gap-2">
          <ViewToggle current={view} />
          <Link
            href="/calendar"
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-fg-muted hover:bg-bg/50 hover:text-fg"
          >
            All segments
          </Link>
        </div>
      </div>
      {events.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
          Nothing on the social calendar for this range.
        </div>
      ) : view === 'week' ? (
        <WeekGrid from={from} to={to} events={events} />
      ) : (
        <MonthGrid cursor={cursor} weekStart={weekStart} events={events} />
      )}
    </div>
  );
}
