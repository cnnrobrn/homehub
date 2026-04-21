/**
 * `/calendar` — unified household calendar (M2-C).
 *
 * Server Component. Reads `view`, `cursor`, `segments` from search params
 * and renders a read-only week or month grid populated from
 * `listEvents()`. Navigation, segment filtering, and view toggling are
 * client islands that write back to the URL so this server render stays
 * the single source of truth.
 *
 * Segment filter is RLS-honest: we compute the member's readable
 * segments from `getHouseholdContext().grants` and only surface those in
 * the filter UI. The helper also intersects the URL's selection with
 * those grants server-side so a hand-edited URL can't reveal forbidden
 * segments.
 */

import Link from 'next/link';

import { CalendarNav } from '@/components/calendar/CalendarNav';
import { MonthGrid } from '@/components/calendar/MonthGrid';
import { RealtimeEventRefresher } from '@/components/calendar/RealtimeEventRefresher';
import { SegmentFilter } from '@/components/calendar/SegmentFilter';
import { ViewToggle } from '@/components/calendar/ViewToggle';
import { WeekGrid } from '@/components/calendar/WeekGrid';
import { Button } from '@/components/ui/button';
import { getHouseholdContext } from '@/lib/auth/context';
import { listEvents, type Segment, SEGMENTS } from '@/lib/events/listEvents';
import {
  calendarWindow,
  formatISODate,
  parseCursor,
  parseView,
  parseWeekStart,
} from '@/lib/events/range';

function parseSegments(
  raw: string | string[] | undefined,
  available: readonly Segment[],
): Segment[] {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return [...available];
  if (value === 'none') return [];
  const requested = value
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is Segment => (SEGMENTS as readonly string[]).includes(s));
  return requested.filter((s) => available.includes(s));
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

export interface CalendarPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const params = await searchParams;
  const view = parseView(typeof params.view === 'string' ? params.view : undefined);
  const cursor = parseCursor(typeof params.cursor === 'string' ? params.cursor : undefined);

  const settings = (ctx.household.settings as { week_start?: unknown }) ?? {};
  const weekStart = parseWeekStart(settings.week_start);

  const { from, to } = calendarWindow(view, cursor, weekStart);

  const grants = ctx.grants.map((g) => ({
    segment: g.segment as Segment,
    access: g.access,
  }));
  const readable = grants.filter((g) => g.access !== 'none').map((g) => g.segment);

  const selected = parseSegments(params.segments, readable);

  const events = await listEvents(
    {
      householdId: ctx.household.id,
      from: from.toISOString(),
      to: to.toISOString(),
      segments: selected.length > 0 ? selected : undefined,
    },
    { grants },
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
      <RealtimeEventRefresher householdId={ctx.household.id} />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
          <p className="text-sm text-fg-muted">
            Everything on the household&apos;s schedule, across all segments.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/settings/connections">Connect another calendar</Link>
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <CalendarNav view={view} cursor={formatISODate(cursor)} title={titleFor(view, from, to)} />
        <div className="flex flex-wrap items-center gap-2">
          <ViewToggle current={view} />
        </div>
      </div>

      {readable.length > 0 ? <SegmentFilter available={readable} selected={selected} /> : null}

      {events.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
          Nothing on your calendar yet. Connect Google Calendar under{' '}
          <Link
            href="/settings/connections"
            className="text-accent underline underline-offset-2 hover:no-underline"
          >
            Settings → Connections
          </Link>{' '}
          to import events.
        </div>
      ) : view === 'week' ? (
        <WeekGrid from={from} to={to} events={events} />
      ) : (
        <MonthGrid cursor={cursor} weekStart={weekStart} events={events} />
      )}
    </div>
  );
}
