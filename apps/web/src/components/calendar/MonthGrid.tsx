/**
 * Month view — a 6×7 (or 5×7 / 4×7) grid of `DayCell`s. We compute the
 * rendered range by expanding from the first-of-month backwards to the
 * week-start and forwards to the week-end after the last day, padding
 * with out-of-month days to keep the grid rectangular.
 *
 * V2 Indie styling: mono weekday headers with subtle surface-soft wash,
 * hairline borders between cells, and warm card shadow wrapping the
 * whole grid.
 */

import { DayCell } from './DayCell';

import type { CalendarEventRow } from '@/lib/events/listEvents';

import {
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
  type WeekStart,
} from '@/lib/events/range';

export interface MonthGridProps {
  cursor: Date;
  weekStart: WeekStart;
  events: CalendarEventRow[];
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function MonthGrid({ cursor, weekStart, events }: MonthGridProps) {
  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, weekStart);
  const gridEnd = endOfWeek(monthEnd, weekStart);

  // Generate the cell grid.
  const cells: Date[] = [];
  const d = new Date(gridStart);
  while (d.getTime() <= gridEnd.getTime()) {
    cells.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }

  // Day-of-week headers.
  const headers = cells
    .slice(0, 7)
    .map((d) => d.toLocaleDateString(undefined, { weekday: 'short' }).toLowerCase());

  // Bucket events by their calendar-day (use the event start's local day
  // for placement; multi-day events show on their first visible day only
  // in the month view — a compromise until drag-drop / spanning lands).
  const byDay = new Map<string, CalendarEventRow[]>();
  for (const ev of events) {
    const start = new Date(ev.startsAt);
    const key = start.toDateString();
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)?.push(ev);
  }

  const today = new Date();

  return (
    <div
      role="grid"
      aria-label="Monthly calendar"
      className="overflow-hidden rounded-[6px] border border-border bg-surface shadow-card"
    >
      <div role="row" className="grid grid-cols-7 border-b border-border bg-surface-soft/60">
        {headers.map((h) => (
          <div
            key={h}
            role="columnheader"
            className="border-r border-border/70 px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-muted last:border-r-0"
          >
            {h}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((cell) => {
          const dayEvents = byDay.get(cell.toDateString()) ?? [];
          return (
            <DayCell
              key={cell.toISOString()}
              date={cell}
              events={dayEvents}
              isCurrentMonth={cell.getMonth() === cursor.getMonth()}
              isToday={isSameDay(cell, today)}
            />
          );
        })}
      </div>
    </div>
  );
}
