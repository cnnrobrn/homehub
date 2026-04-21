/**
 * Month-view day cell. Rendered as a button so keyboard users can drill
 * into the week view by selecting a day. Shows up to `maxEvents` pills
 * and a "+N more" overflow — the pills themselves are non-interactive
 * chrome (no create/edit in M2-C) so we don't need to nest buttons.
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
        'flex min-h-[96px] flex-col gap-1 border-b border-r border-border/60 p-1.5 text-xs',
        !isCurrentMonth && 'bg-surface/40 text-fg-muted/70',
      )}
    >
      <div className="flex items-center justify-between">
        <DayCellNavButton
          cursor={iso}
          label={date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
          isToday={isToday}
        />
      </div>
      <ul className="flex flex-col gap-0.5">
        {visible.map((ev) => (
          <li key={ev.id}>
            <EventPill event={ev} compact />
          </li>
        ))}
      </ul>
      {overflow > 0 ? (
        <span className="mt-auto text-[11px] text-fg-muted" aria-label={`${overflow} more events`}>
          +{overflow} more
        </span>
      ) : null}
    </div>
  );
}
