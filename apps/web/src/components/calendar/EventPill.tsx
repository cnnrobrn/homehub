/**
 * Single event chip used inside week/month grids.
 *
 * V2 Indie rendering: a small card with a 2px segment-colored left
 * stripe, mono time on top, sans title below. Matches the reference in
 * `project/app/view-calendar.jsx` (the week grid chips). Stays a Server
 * Component — no state, no interactivity.
 *
 * The accessible description combines segment, title, time, and location
 * so screen readers don't rely on color alone — color is an augmenting
 * signal on top of the always-present label.
 */


import { SEGMENT_BORDER_CLASS, SEGMENT_LABEL } from './segmentStyles';

import type { CalendarEventRow } from '@/lib/events/listEvents';

import { cn } from '@/lib/cn';

function formatTime(iso: string, allDay: boolean): string {
  if (allDay) return 'All day';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export interface EventPillProps {
  event: Pick<
    CalendarEventRow,
    'id' | 'segment' | 'title' | 'startsAt' | 'endsAt' | 'allDay' | 'location'
  >;
  compact?: boolean;
  className?: string;
}

export function EventPill({ event, compact = false, className }: EventPillProps) {
  const time = formatTime(event.startsAt, event.allDay);
  const borderClass = SEGMENT_BORDER_CLASS[event.segment];
  const segmentLabel = SEGMENT_LABEL[event.segment];
  const descId = `event-${event.id}-desc`;

  return (
    <article
      id={`event-${event.id}`}
      data-testid={`event-pill-${event.segment}`}
      aria-describedby={descId}
      className={cn(
        'flex flex-col gap-0.5 rounded-[3px] border border-border border-l-2 bg-surface px-2 py-1.5 text-left text-fg',
        borderClass,
        compact && 'px-1.5 py-1',
        className,
      )}
    >
      <span id={descId} className="sr-only">
        {segmentLabel}: {event.title} at {time}
        {event.location ? ` (${event.location})` : ''}
      </span>
      <span aria-hidden="true" className="font-mono text-[10px] tracking-[0.04em] text-fg-muted">
        {time}
      </span>
      <span
        aria-hidden="true"
        className={cn('truncate text-[12.5px] leading-[1.3] text-fg', compact && 'text-[11.5px]')}
      >
        {event.title}
      </span>
      {!compact && event.location ? (
        <span
          aria-hidden="true"
          className="truncate font-mono text-[10px] tracking-[0.02em] text-fg-muted"
        >
          {event.location}
        </span>
      ) : null}
    </article>
  );
}
