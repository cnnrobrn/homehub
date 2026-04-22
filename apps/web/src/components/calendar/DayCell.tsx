/**
 * Month-view day cell. The day-of-month header is a click target that
 * deep-links into the week view for that day (see `DayCellNavButton`).
 * Shows up to `maxEvents` chips and a mono "+N more" overflow.
 *
 * V2 Indie styling: warm hairline borders, quiet mono accents, the
 * "today" cell picks up the `--surface-note` wash so it reads without
 * needing a heavy pill on the number.
 */


import { DayCellNavButton } from './DayCellNavButton';
import { EventPill } from './EventPill';

import type { CalendarEventRow } from '@/lib/events/listEvents';

import { cn } from '@/lib/cn';
import { formatISODate } from '@/lib/events/range';

export interface DayCellProps {
  date: Date;
  events: CalendarEventRow[];
  isCurrentMonth: boolean;
  isToday: boolean;
  maxEvents?: number;
}

export function DayCell({ date, events, isCurrentMonth, isToday, maxEvents = 3 }: DayCellProps) {
  const visible = events.slice(0, maxEvents);
  const overflow = Math.max(0, events.length - visible.length);
  const iso = formatISODate(date);

  return (
    <div
      role="gridcell"
      aria-label={date.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })}
      className={cn(
        'flex min-h-[108px] flex-col gap-1.5 border-r border-b border-border/70 p-2',
        !isCurrentMonth && 'bg-surface/60 text-fg-muted',
        isToday && 'bg-surface-note',
      )}
    >
      <div className="flex items-center justify-between">
        <DayCellNavButton
          cursor={iso}
          label={date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
          isToday={isToday}
        />
      </div>
      <ul className="flex flex-col gap-1">
        {visible.map((ev) => (
          <li key={ev.id}>
            <EventPill event={ev} compact />
          </li>
        ))}
      </ul>
      {overflow > 0 ? (
        <span
          className="mt-auto font-mono text-[10px] tracking-[0.04em] text-fg-muted"
          aria-label={`${overflow} more events`}
        >
          +{overflow} more
        </span>
      ) : null}
    </div>
  );
}
