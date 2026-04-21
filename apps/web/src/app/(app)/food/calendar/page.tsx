/**
 * `/food/calendar` — segment-scoped view of the unified calendar.
 *
 * Reuses the main calendar components with `segments=['food']`
 * hard-wired. Members see only food events (meals mirrored from
 * `app.meal` + any food-segment items on `app.event`).
 */

import { CalendarNav } from '@/components/calendar/CalendarNav';
import { MonthGrid } from '@/components/calendar/MonthGrid';
import { RealtimeEventRefresher } from '@/components/calendar/RealtimeEventRefresher';
import { ViewToggle } from '@/components/calendar/ViewToggle';
import { WeekGrid } from '@/components/calendar/WeekGrid';
import { getHouseholdContext } from '@/lib/auth/context';
import { listEvents, type Segment } from '@/lib/events/listEvents';
import {
  calendarWindow,
  formatISODate,
  parseCursor,
  parseView,
  parseWeekStart,
} from '@/lib/events/range';

export interface FoodCalendarPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstString(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
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

export default async function FoodCalendarPage({ searchParams }: FoodCalendarPageProps) {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const params = await searchParams;
  const view = parseView(firstString(params.view));
  const cursor = parseCursor(firstString(params.cursor));
  const settings = (ctx.household.settings as { week_start?: unknown }) ?? {};
  const weekStart = parseWeekStart(settings.week_start);

  const { from, to } = calendarWindow(view, cursor, weekStart);
  const grants = ctx.grants.map((g) => ({
    segment: g.segment as Segment,
    access: g.access,
  }));
  const events = await listEvents(
    {
      householdId: ctx.household.id,
      from: from.toISOString(),
      to: to.toISOString(),
      segments: ['food'],
    },
    { grants },
  );

  return (
    <div className="flex flex-col gap-4">
      <RealtimeEventRefresher householdId={ctx.household.id} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CalendarNav view={view} cursor={formatISODate(cursor)} title={titleFor(view, from, to)} />
        <ViewToggle current={view} />
      </div>
      {view === 'week' ? (
        <WeekGrid from={from} to={to} events={events} />
      ) : (
        <MonthGrid cursor={cursor} weekStart={weekStart} events={events} />
      )}
    </div>
  );
}
