/**
 * Single event chip used inside week/month grids and the dashboard Today
 * strip. Server Component — no state, no interactivity. A left-border
 * accent encodes the segment (color + icon is handled by the parent
 * `<SegmentFilter>` legend; the pill itself shows time + title and the
 * colored bar so the palette isn't the only signal).
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
        'flex flex-col gap-0.5 rounded-sm border-l-2 bg-surface/80 px-2 py-1 text-left text-xs text-fg',
        borderClass,
        compact && 'py-0.5 text-[11px] leading-tight',
        className,
      )}
    >
      <span id={descId} className="sr-only">
        {segmentLabel}: {event.title} at {time}
        {event.location ? ` (${event.location})` : ''}
      </span>
      <span className="flex items-center gap-1.5 truncate">
        <span className="font-medium tabular-nums text-fg-muted" aria-hidden="true">
          {time}
        </span>
        <span className="truncate" aria-hidden="true">
          {event.title}
        </span>
      </span>
      {!compact && event.location ? (
        <span className="truncate text-[11px] text-fg-muted" aria-hidden="true">
          {event.location}
        </span>
      ) : null}
    </article>
  );
}
