/**
 * `/fun/trips/[tripId]` — trip detail with child event timeline.
 */

import { notFound } from 'next/navigation';

import { FunRealtimeRefresher } from '@/components/fun/FunRealtimeRefresher';
import { TripTimeline } from '@/components/fun/TripTimeline';
import { getHouseholdContext } from '@/lib/auth/context';
import {
  listFunEvents,
  listFunSuggestions,
  listTrips,
  type FunEventRow,
  type SegmentGrant,
} from '@/lib/fun';

export interface TripDetailPageProps {
  params: Promise<{ tripId: string }>;
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default async function TripDetailPage({ params }: TripDetailPageProps) {
  const { tripId } = await params;
  if (!isUuid(tripId)) notFound();

  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));

  const [trips, childEvents, suggestions] = await Promise.all([
    listTrips({ householdId: ctx.household.id, includePast: true }, { grants }),
    listFunEvents(
      { householdId: ctx.household.id, tripId, excludeTripParents: true, limit: 200 },
      { grants },
    ),
    listFunSuggestions(
      { householdId: ctx.household.id, kinds: ['trip_prep'], limit: 5 },
      { grants },
    ),
  ]);

  const trip = trips.find((t) => t.id === tripId);
  if (!trip) notFound();

  const tripPrep = suggestions.find((s) => s.kind === 'trip_prep' && s.preview.trip_id === tripId);
  const checklist: string[] =
    tripPrep && Array.isArray(tripPrep.preview.checklist)
      ? (tripPrep.preview.checklist as string[])
      : [];

  return (
    <div className="flex flex-col gap-6">
      <FunRealtimeRefresher householdId={ctx.household.id} />

      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight">{trip.title}</h2>
        <p className="text-sm text-fg-muted">
          {formatDate(trip.startsAt)} – {formatDate(trip.endsAt)}
          {trip.location ? ` · ${trip.location}` : ''}
        </p>
      </header>

      {checklist.length > 0 ? (
        <section aria-labelledby="checklist-heading" className="flex flex-col gap-2">
          <h3 id="checklist-heading" className="text-sm font-medium">
            Packing checklist
          </h3>
          <ul className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4 text-sm">
            {checklist.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span aria-hidden="true" className="text-fg-muted">
                  •
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="timeline-heading" className="flex flex-col gap-2">
        <h3 id="timeline-heading" className="text-sm font-medium">
          Itinerary ({childEvents.length as number})
        </h3>
        <TripTimeline events={childEvents as FunEventRow[]} />
      </section>
    </div>
  );
}
