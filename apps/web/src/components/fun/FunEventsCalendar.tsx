/**
 * `<FunEventsCalendar />` — chronological list of upcoming fun events.
 *
 * Server Component. A thin wrapper around the event list pattern used
 * elsewhere; the full WeekGrid/MonthGrid lives on `/calendar` and is
 * invoked via a link when the member wants the broader view.
 */

import Link from 'next/link';

import { type FunEventRow } from '@/lib/fun';

export interface FunEventsCalendarProps {
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

export function FunEventsCalendar({ events }: FunEventsCalendarProps) {
  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
        Nothing on the fun calendar. Visit the{' '}
        <Link
          href="/calendar"
          className="text-accent underline underline-offset-2 hover:no-underline"
        >
          unified calendar
        </Link>{' '}
        for a household-wide view.
      </div>
    );
  }

  return (
    <ul role="list" className="divide-y divide-border rounded-lg border border-border bg-surface">
      {events.map((event) => (
        <li key={event.id} className="flex items-start gap-3 p-3 text-sm">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="font-medium text-fg">{event.title}</span>
            <span className="text-xs text-fg-muted">
              {formatWhen(event.startsAt, event.allDay)}
              {event.location ? ` · ${event.location}` : ''}
            </span>
          </div>
          <span className="rounded-sm border border-border bg-bg px-2 py-0.5 text-[11px] uppercase tracking-wide text-fg-muted">
            {event.kind.replace(/_/g, ' ')}
          </span>
        </li>
      ))}
    </ul>
  );
}
