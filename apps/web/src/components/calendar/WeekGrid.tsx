/**
 * Week view: 7 day columns × 24 hours, plus a top "all day" strip.
 *
 * Rendering strategy:
 *   - All-day + multi-day events live in the top strip.
 *   - Timed events are positioned absolutely within their day column
 *     using `top` + `height` percentages derived from start/end minutes.
 *   - Events that overlap the column boundary on either side clamp to
 *     the visible range (0–24h) so a Sunday-evening event that extends
 *     into Monday morning doesn't bleed across columns.
 *
 * Server Component — read only. Interactivity (prev/next, filters) lives
 * outside the grid on the page-level controls.
 */

import { EventPill } from './EventPill';
import { SEGMENT_BORDER_CLASS } from './segmentStyles';

import type { CalendarEventRow } from '@/lib/events/listEvents';

import { cn } from '@/lib/cn';
import { daysInRange } from '@/lib/events/range';

export interface WeekGridProps {
  from: Date;
  to: Date;
  events: CalendarEventRow[];
}

const MINUTES_IN_DAY = 24 * 60;

function isAllDayOrMultiDay(ev: CalendarEventRow, dayStart: Date, dayEnd: Date): boolean {
  if (ev.allDay) return true;
  const start = new Date(ev.startsAt);
  const end = ev.endsAt ? new Date(ev.endsAt) : start;
  return start < dayStart && end > dayEnd;
}

function minutesFromMidnight(d: Date, reference: Date): number {
  const ref = new Date(reference);
  ref.setHours(0, 0, 0, 0);
  return Math.max(0, Math.min(MINUTES_IN_DAY, (d.getTime() - ref.getTime()) / 60_000));
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function WeekGrid({ from, to, events }: WeekGridProps) {
  const days = daysInRange(from, to);
  const today = new Date();
  const hours = Array.from({ length: 24 }, (_, i) => i);

  // Bucket events by day.
  const byDay = new Map<string, CalendarEventRow[]>();
  const allDay: Array<{ event: CalendarEventRow; day: Date }> = [];

  for (const day of days) {
    const key = day.toDateString();
    byDay.set(key, []);
  }

  for (const ev of events) {
    const start = new Date(ev.startsAt);
    const end = ev.endsAt ? new Date(ev.endsAt) : start;
    for (const day of days) {
      const dayStart = new Date(day);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(day);
      dayEnd.setHours(23, 59, 59, 999);

      // Event overlaps this day at all?
      if (end < dayStart || start > dayEnd) continue;

      if (isAllDayOrMultiDay(ev, dayStart, dayEnd)) {
        // Only add to the all-day strip once per event per visible day
        // it overlaps. For simplicity, anchor on the first matching day
        // so the pill isn't repeated across the week.
        if (
          !allDay.some((a) => a.event.id === ev.id) &&
          isSameDay(dayStart, new Date(Math.max(start.getTime(), from.getTime())))
        ) {
          allDay.push({ event: ev, day });
        }
      } else {
        byDay.get(day.toDateString())?.push(ev);
      }
    }
  }

  return (
    <div
      role="grid"
      aria-label="Weekly calendar"
      className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface"
    >
      {/* Header row: day names */}
      <div
        role="row"
        className="grid grid-cols-[auto_repeat(7,minmax(0,1fr))] border-b border-border bg-bg/60"
      >
        <div className="w-14 border-r border-border px-2 py-2 text-[11px] text-fg-muted" />
        {days.map((d) => (
          <div
            key={d.toISOString()}
            role="columnheader"
            className={cn(
              'flex flex-col gap-0.5 border-r border-border px-2 py-2 text-xs last:border-r-0',
              isSameDay(d, today) && 'bg-accent/10 text-fg',
            )}
          >
            <span className="font-medium">
              {d.toLocaleDateString(undefined, { weekday: 'short' })}
            </span>
            <span className="tabular-nums text-fg-muted">{d.getDate()}</span>
          </div>
        ))}
      </div>

      {/* All-day strip */}
      {allDay.length > 0 ? (
        <div
          role="row"
          className="grid grid-cols-[auto_repeat(7,minmax(0,1fr))] border-b border-border"
        >
          <div className="w-14 border-r border-border px-2 py-1 text-[11px] text-fg-muted">
            All day
          </div>
          {days.map((day) => {
            const dayStart = new Date(day);
            dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(day);
            dayEnd.setHours(23, 59, 59, 999);
            const list = allDay.filter(({ event }) => {
              const start = new Date(event.startsAt);
              const end = event.endsAt ? new Date(event.endsAt) : start;
              return end >= dayStart && start <= dayEnd;
            });
            return (
              <div
                key={day.toISOString()}
                role="gridcell"
                className="flex flex-col gap-0.5 border-r border-border p-1 last:border-r-0"
              >
                {list.map(({ event }) => (
                  <EventPill key={`${event.id}-${day.toISOString()}`} event={event} compact />
                ))}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Time grid */}
      <div
        role="row"
        className="relative grid grid-cols-[auto_repeat(7,minmax(0,1fr))]"
        style={{ minHeight: '720px' }}
      >
        {/* Hour labels (first column) */}
        <div className="flex w-14 flex-col border-r border-border">
          {hours.map((h) => (
            <div
              key={h}
              className="h-8 border-b border-border/60 px-2 pt-0.5 text-[10px] text-fg-muted"
            >
              {h === 0 ? '' : `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'a' : 'p'}`}
            </div>
          ))}
        </div>

        {/* 7 day columns */}
        {days.map((day) => {
          const dayEvents = byDay.get(day.toDateString()) ?? [];
          const dayStart = new Date(day);
          dayStart.setHours(0, 0, 0, 0);
          return (
            <div
              key={day.toISOString()}
              role="gridcell"
              className={cn(
                'relative border-r border-border last:border-r-0',
                isSameDay(day, today) && 'bg-accent/[0.04]',
              )}
              aria-label={day.toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            >
              {/* 24 hour gridlines */}
              {hours.map((h) => (
                <div key={h} className="h-8 border-b border-border/60" aria-label={`${h}:00`} />
              ))}
              {/* Absolutely-positioned events */}
              {dayEvents.map((ev) => {
                const start = new Date(ev.startsAt);
                const end = ev.endsAt
                  ? new Date(ev.endsAt)
                  : new Date(start.getTime() + 30 * 60_000);
                const startMin = minutesFromMidnight(start, dayStart);
                const endMin = minutesFromMidnight(end, dayStart);
                const topPct = (startMin / MINUTES_IN_DAY) * 100;
                const heightPct = Math.max(2, ((endMin - startMin) / MINUTES_IN_DAY) * 100);
                return (
                  <div
                    key={ev.id}
                    className={cn(
                      'absolute inset-x-0.5 overflow-hidden rounded-sm border-l-2 bg-bg/80 px-1 py-0.5 text-[11px]',
                      SEGMENT_BORDER_CLASS[ev.segment],
                    )}
                    style={{ top: `${topPct}%`, height: `${heightPct}%` }}
                  >
                    <EventPill event={ev} compact className="border-l-0 bg-transparent p-0" />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
