/**
 * `/fun/trips` — all trips (upcoming and past).
 */

import Link from 'next/link';

import { TripList } from '@/components/fun/TripList';
import { getHouseholdContext } from '@/lib/auth/context';
import { cn } from '@/lib/cn';
import { listTrips, type SegmentGrant } from '@/lib/fun';

export interface TripsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstString(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

export default async function TripsPage({ searchParams }: TripsPageProps) {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const params = await searchParams;
  const includePast = firstString(params.include) === 'past';

  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));

  const trips = await listTrips(
    { householdId: ctx.household.id, includePast, limit: 100 },
    { grants },
  );

  const pillBase =
    'rounded-sm border border-border bg-bg px-2 py-1 text-xs text-fg-muted hover:text-fg';

  return (
    <div className="flex flex-col gap-4">
      <div role="toolbar" aria-label="Filter trips" className="flex flex-wrap items-center gap-2">
        <Link
          href="/fun/trips"
          className={cn(pillBase, !includePast && 'bg-surface font-medium text-fg')}
        >
          Upcoming
        </Link>
        <Link
          href="/fun/trips?include=past"
          className={cn(pillBase, includePast && 'bg-surface font-medium text-fg')}
        >
          Include past
        </Link>
      </div>
      <TripList trips={trips} />
    </div>
  );
}
