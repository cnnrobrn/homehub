/**
 * `/fun/calendar` — fun-only calendar view, reusing the dashboard list.
 */

import Link from 'next/link';

import { FunEventsCalendar } from '@/components/fun/FunEventsCalendar';
import { getHouseholdContext } from '@/lib/auth/context';
import { listFunEvents, type SegmentGrant } from '@/lib/fun';

export default async function FunCalendarPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));

  const now = new Date();
  const horizon = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000);

  const events = await listFunEvents(
    {
      householdId: ctx.household.id,
      from: now.toISOString(),
      to: horizon.toISOString(),
      limit: 200,
    },
    { grants },
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg-muted">
        Upcoming fun events. For the unified household calendar, open{' '}
        <Link
          href="/calendar"
          className="text-accent underline underline-offset-2 hover:no-underline"
        >
          /calendar
        </Link>
        .
      </p>
      <FunEventsCalendar events={events} />
    </div>
  );
}
