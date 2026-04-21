/**
 * `<TripList />` — shows upcoming trips as cards with a link through to
 * the trip detail view.
 */

import Link from 'next/link';

import { type TripRow } from '@/lib/fun';

export interface TripListProps {
  trips: TripRow[];
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function TripList({ trips }: TripListProps) {
  if (trips.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
        No trips yet. When a cluster of fun events lands on your calendar, HomeHub will propose a
        trip parent.
      </div>
    );
  }

  return (
    <ul role="list" className="flex flex-col gap-3">
      {trips.map((trip) => (
        <li key={trip.id} className="rounded-lg border border-border bg-surface p-4">
          <Link
            href={`/fun/trips/${trip.id}`}
            className="flex flex-col gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <span className="text-sm font-semibold text-fg">{trip.title}</span>
            <span className="text-xs text-fg-muted">
              {formatDate(trip.startsAt)} – {formatDate(trip.endsAt)}
              {trip.location ? ` · ${trip.location}` : ''}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
