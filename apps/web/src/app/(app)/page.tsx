/**
 * `/` — Dashboard (authenticated).
 *
 * M1 ships a dressed stub: household name, member count, a placeholder
 * "Today" strip, and four disabled segment cards. The real dashboard
 * (Today strip with real events, alert bar, suggestion carousel, segment
 * tiles with status) lands in M2+ as each segment comes online.
 *
 * Server Component — no data fetch beyond the already-resolved household
 * context from the layout (via `getHouseholdContext()`). Keep it that way
 * until a segment card needs data; once it does, the call belongs on the
 * card itself with a Suspense boundary.
 */

import { Calendar, CircleDollarSign, PartyPopper, Users, Utensils } from 'lucide-react';

import { listMembersAction } from '@/app/actions/members';
import { SegmentCard } from '@/components/dashboard/SegmentCard';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getHouseholdContext } from '@/lib/auth/context';

export default async function DashboardPage() {
  const ctx = await getHouseholdContext();
  // Layout already redirected if ctx was null; this is just a type guard.
  if (!ctx) return null;

  const membersRes = await listMembersAction({ householdId: ctx.household.id });
  const memberCount = membersRes.ok ? membersRes.data.length : 0;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-fg-muted">Household</p>
        <h1 className="text-3xl font-semibold tracking-tight">{ctx.household.name}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          <Badge variant="outline">{ctx.member.role}</Badge>
          <span>·</span>
          <span>
            {memberCount} {memberCount === 1 ? 'member' : 'members'}
          </span>
        </div>
      </header>

      <section aria-labelledby="today-heading" className="flex flex-col gap-3">
        <h2 id="today-heading" className="text-lg font-medium">
          Today
        </h2>
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <Calendar className="h-4 w-4 text-fg-muted" aria-hidden="true" />
            <CardTitle className="text-sm">Nothing scheduled yet</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-fg-muted">
              Once a member connects a calendar (Google Calendar lands in M2), today&apos;s events
              will appear here.
            </p>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="segments-heading" className="flex flex-col gap-3">
        <h2 id="segments-heading" className="text-lg font-medium">
          Segments
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SegmentCard
            label="Financial"
            description="Budgets, accounts, subscriptions"
            icon={<CircleDollarSign className="h-5 w-5" aria-hidden="true" />}
          />
          <SegmentCard
            label="Food"
            description="Meal planner, pantry, groceries"
            icon={<Utensils className="h-5 w-5" aria-hidden="true" />}
          />
          <SegmentCard
            label="Fun"
            description="Trips, queue, plans"
            icon={<PartyPopper className="h-5 w-5" aria-hidden="true" />}
          />
          <SegmentCard
            label="Social"
            description="People, contacts, events"
            icon={<Users className="h-5 w-5" aria-hidden="true" />}
          />
        </div>
      </section>
    </div>
  );
}
