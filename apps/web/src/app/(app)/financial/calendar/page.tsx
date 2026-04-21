/**
 * `/financial/calendar` — financial-segment-only calendar.
 *
 * Reuses the unified calendar primitives (`WeekGrid`, `MonthGrid`) and
 * fixes the segment filter to `['financial']`. In addition to
 * `app.event` rows it overlays transaction charges and subscription
 * next-charge projections, transformed via `transactionsToCalendarItems`.
 */

import Link from 'next/link';

import { CalendarNav } from '@/components/calendar/CalendarNav';
import { MonthGrid } from '@/components/calendar/MonthGrid';
import { ViewToggle } from '@/components/calendar/ViewToggle';
import { WeekGrid } from '@/components/calendar/WeekGrid';
import { FinancialRealtimeRefresher } from '@/components/financial/FinancialRealtimeRefresher';
import { transactionsToCalendarItems } from '@/components/financial/transactionsToCalendarItems';
import { getHouseholdContext } from '@/lib/auth/context';
import { listEvents } from '@/lib/events/listEvents';
import {
  calendarWindow,
  formatISODate,
  parseCursor,
  parseView,
  parseWeekStart,
} from '@/lib/events/range';
import { listSubscriptions, listTransactions, type SegmentGrant } from '@/lib/financial';

export interface FinancialCalendarPageProps {
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

export default async function FinancialCalendarPage({ searchParams }: FinancialCalendarPageProps) {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const params = await searchParams;
  const view = parseView(typeof params.view === 'string' ? params.view : undefined);
  const cursor = parseCursor(typeof params.cursor === 'string' ? params.cursor : undefined);

  const settings = (ctx.household.settings as { week_start?: unknown }) ?? {};
  const weekStart = parseWeekStart(settings.week_start);
  const { from, to } = calendarWindow(view, cursor, weekStart);

  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));
  const eventsGrants = ctx.grants.map((g) => ({
    segment: g.segment as 'financial' | 'food' | 'fun' | 'social' | 'system',
    access: g.access,
  }));

  const [events, transactions, subscriptions] = await Promise.all([
    listEvents(
      {
        householdId: ctx.household.id,
        from: from.toISOString(),
        to: to.toISOString(),
        segments: ['financial'],
      },
      { grants: eventsGrants },
    ),
    listTransactions(
      {
        householdId: ctx.household.id,
        from: from.toISOString(),
        to: to.toISOString(),
        limit: 500,
      },
      { grants },
    ),
    listSubscriptions({ householdId: ctx.household.id }, { grants }),
  ]);

  const combined = [
    ...events,
    ...transactionsToCalendarItems(transactions, subscriptions, {
      from,
      to,
      householdId: ctx.household.id,
    }),
  ];
  combined.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return (
    <div className="flex flex-col gap-4">
      <FinancialRealtimeRefresher householdId={ctx.household.id} />
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

      {combined.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
          Nothing on the financial calendar for this range.
        </div>
      ) : view === 'week' ? (
        <WeekGrid from={from} to={to} events={combined} />
      ) : (
        <MonthGrid cursor={cursor} weekStart={weekStart} events={combined} />
      )}
    </div>
  );
}
