/**
 * Week view — a calm, 7-column grid across the week.
 *
 * V2 Indie rendering: each day is a single stacked column with a mono
 * day-of-week label, a bold day number, and a vertical list of event
 * chips ordered by start time. A 1px hairline separates days. The
 * "today" column gets the `--surface-note` tint in its header cell and
 * a lighter body tint so the current day stands out without noise.
 *
 * Events are bucketed per visible day; an event that spans multiple
 * days (or is marked all-day) appears on each day it overlaps so the
 * grid reads naturally across the week. Ordering inside a day puts
 * all-day events first, then timed events sorted by `startsAt`.
 *
 * Server Component — read only. Interactivity (prev/next, filters)
 * lives outside the grid on the page-level controls.
 */

import { EventPill } from './EventPill';

import type { CalendarEventRow } from '@/lib/events/listEvents';

import { cn } from '@/lib/cn';
import { daysInRange } from '@/lib/events/range';

export interface WeekGridProps {
  from: Date;
  to: Date;
  events: CalendarEventRow[];
}

/** Highlighted friday-body tint from the design handoff. */
const FRIDAY_BG = '#fbf8f2';

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function eventOverlapsDay(ev: CalendarEventRow, day: Date): boolean {
  const start = new Date(ev.startsAt);
  const end = ev.endsAt ? new Date(ev.endsAt) : start;
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(day);
  dayEnd.setHours(23, 59, 59, 999);
  return !(end < dayStart || start > dayEnd);
}

function compareByStart(a: CalendarEventRow, b: CalendarEventRow): number {
  if (a.allDay && !b.allDay) return -1;
  if (!a.allDay && b.allDay) return 1;
  return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
}

export function WeekGrid({ from, to, events }: WeekGridProps) {
  const days = daysInRange(from, to);
  const today = new Date();

  return (
    <div
      role="grid"
      aria-label="Weekly calendar"
      className="grid grid-cols-1 overflow-hidden rounded-[6px] border border-border bg-surface shadow-card sm:grid-cols-7"
    >
      {days.map((day, i) => {
        const dayEvents = events
          .filter((ev) => eventOverlapsDay(ev, day))
          .slice()
          .sort(compareByStart);
        const isToday = isSameDay(day, today);
        const isFriday = day.getDay() === 5;
        const weekday = day.toLocaleDateString(undefined, { weekday: 'short' }).toLowerCase();
        const aria = day.toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        });

        return (
          <div
            key={day.toISOString()}
            role="gridcell"
            aria-label={aria}
            className={cn(
              'flex min-h-[360px] flex-col gap-2 px-3 pt-3.5 pb-4',
              // Hairline between days; first column has no leading rule,
              // and on mobile we stack so a top border replaces the left.
              i > 0 && 'border-t border-border sm:border-t-0 sm:border-l sm:border-border',
              isToday && !isFriday && 'bg-surface-note',
            )}
            style={isFriday ? { background: FRIDAY_BG } : undefined}
          >
            <div className="mb-0.5 flex items-baseline gap-1.5">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-muted">
                {weekday}
              </span>
              <span
                className={cn(
                  'text-[15px] tabular-nums text-fg',
                  isToday ? 'font-semibold' : 'font-normal',
                )}
              >
                {day.getDate()}
              </span>
              {isToday ? (
                <span className="ml-auto font-mono text-[9.5px] uppercase tracking-[0.08em] text-accent">
                  today
                </span>
              ) : null}
            </div>

            {dayEvents.length === 0 ? (
              <span
                aria-hidden="true"
                className="font-mono text-[10px] tracking-[0.04em] text-fg-muted/70"
              >
                {'—'}
              </span>
            ) : (
              dayEvents.map((ev) => <EventPill key={`${ev.id}-${day.toISOString()}`} event={ev} />)
            )}
          </div>
        );
      })}
    </div>
  );
}
