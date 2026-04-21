/**
 * `<TripTimeline />` — vertical timeline of child events for a trip.
 *
 * Server Component. Each event row is keyboard-navigable via a link
 * that deep-links back to the unified calendar.
 */

import Link from 'next/link';

import { type FunEventRow } from '@/lib/fun';

export interface TripTimelineProps {
  events: FunEventRow[];
}

function formatWhen(iso: string, allDay: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (allDay) {
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function TripTimeline({ events }: TripTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
        No sub-events linked to this trip yet.
      </div>
    );
  }

  return (
    <ol
      role="list"
      aria-label="Trip events"
      className="flex flex-col gap-0 rounded-lg border border-border bg-surface"
    >
      {events.map((event, idx) => (
        <li
          key={event.id}
          className={idx === events.length - 1 ? 'p-3' : 'p-3 border-b border-border'}
        >
          <Link
            href={`/calendar?cursor=${event.startsAt.slice(0, 10)}` as never}
            className="flex flex-col gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <span className="text-sm font-semibold text-fg">{event.title}</span>
            <span className="text-xs text-fg-muted">
              {formatWhen(event.startsAt, event.allDay)}
              {event.location ? ` · ${event.location}` : ''}
              {event.kind ? ` · ${event.kind.replace(/_/g, ' ')}` : ''}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
