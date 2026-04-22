/**
 * `/calendar` — unified household calendar (M2-C), V2 Indie re-skin.
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
 *
 * Layout: a calm page header ("APR · WEEK 17" eyebrow → "This week"
 * headline → soft sub-line), an inline legend of the readable segments,
 * the grid, and a quiet footer with a connection shortcut. Follows the
 * rhythm established by the restyled dashboard (`/`).
 */

import Link from 'next/link';

import { CalendarNav } from '@/components/calendar/CalendarNav';
import { MonthGrid } from '@/components/calendar/MonthGrid';
import { RealtimeEventRefresher } from '@/components/calendar/RealtimeEventRefresher';
import { SegmentFilter } from '@/components/calendar/SegmentFilter';
import { ViewToggle } from '@/components/calendar/ViewToggle';
import { WeekGrid } from '@/components/calendar/WeekGrid';
import { Eyebrow, WarmButton } from '@/components/design-system';
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

/** ISO week number (ISO 8601) — used for the "week 17" eyebrow. */
function isoWeekNumber(d: Date): number {
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function eyebrowFor(view: 'week' | 'month', from: Date): string {
  const month = from.toLocaleDateString(undefined, { month: 'short' }).toLowerCase();
  if (view === 'month') {
    return `${month} · ${from.getFullYear()}`;
  }
  return `${month} · week ${isoWeekNumber(from)}`;
}

function titleFor(view: 'week' | 'month', from: Date, to: Date): string {
  if (view === 'month') {
    return from.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  if (today >= start && today <= end) return 'This week';
  return today < start ? 'Next up' : 'Last week';
}

function rangeCaption(from: Date, to: Date): string {
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

  const eyebrow = eyebrowFor(view, from);
  const title = titleFor(view, from, to);
  const caption = rangeCaption(from, to);

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col px-10 pt-9 pb-20">
      <RealtimeEventRefresher householdId={ctx.household.id} />

      {/* Page header */}
      <header className="mb-7 flex flex-wrap items-end gap-4">
        <div className="min-w-0">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="mt-1.5 text-[30px] font-semibold leading-[1.15] tracking-[-0.03em] text-fg">
            {title}
          </h1>
          <p className="mt-1.5 font-mono text-[11px] tracking-[0.04em] text-fg-muted">{caption}</p>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">
          <CalendarNav view={view} cursor={formatISODate(cursor)} title={caption} />
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          <ViewToggle current={view} />
          <Link href="/settings/connections" className="no-underline">
            <WarmButton variant="ghost" size="sm">
              + connect calendar
            </WarmButton>
          </Link>
        </div>
      </header>

      {/* Legend / segment filter */}
      {readable.length > 0 ? (
        <div className="mb-5">
          <SegmentFilter available={readable} selected={selected} />
        </div>
      ) : null}

      {/* Grid */}
      {events.length === 0 ? (
        <EmptyState />
      ) : view === 'week' ? (
        <WeekGrid from={from} to={to} events={events} />
      ) : (
        <MonthGrid cursor={cursor} weekStart={weekStart} events={events} />
      )}

      {/* Footer */}
      <footer className="mt-10 flex items-center gap-4 border-t border-border pt-5 font-mono text-[11px] tracking-[0.02em] text-fg-muted">
        <span>{events.length === 0 ? 'nothing on the calendar' : `${events.length} on deck`}</span>
        <span aria-hidden="true">·</span>
        <span>a quiet weekly view</span>
        <div className="flex-1" />
        <Link
          href="/settings/connections"
          className="text-fg-muted transition-colors hover:text-fg"
        >
          manage calendars {'→'}
        </Link>
      </footer>
    </div>
  );
}

/* ── Empty state ──────────────────────────────────────────────── */

function EmptyState() {
  return (
    <div className="rounded-[6px] border border-border bg-surface px-6 py-10 text-center shadow-card">
      <div className="mx-auto max-w-[420px]">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
          {'— empty week'}
        </div>
        <p className="mt-3 text-[15.5px] leading-[1.55] text-fg">Nothing on the calendar yet.</p>
        <p className="mt-1.5 text-[13.5px] leading-[1.55] text-fg-muted">
          Connect Google Calendar and we&apos;ll pull the week in. No pushing, no badges — just
          what&apos;s already yours, laid out quietly.
        </p>
        <div className="mt-4 flex justify-center">
          <Link href="/settings/connections" className="no-underline">
            <WarmButton variant="primary" size="sm">
              Connect a calendar {'→'}
            </WarmButton>
          </Link>
        </div>
      </div>
    </div>
  );
}
