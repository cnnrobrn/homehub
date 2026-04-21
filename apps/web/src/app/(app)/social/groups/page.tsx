/**
 * `/social/groups` — list of household groups.
 */

import { GroupList } from '@/components/social/GroupList';
import { SocialRealtimeRefresher } from '@/components/social/SocialRealtimeRefresher';
import { getHouseholdContext } from '@/lib/auth/context';
import { listGroups, type SegmentGrant } from '@/lib/social';

export default async function GroupsPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;
  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));
  const groups = await listGroups({ householdId: ctx.household.id }, { grants });
  return (
    <div className="flex flex-col gap-4">
      <SocialRealtimeRefresher householdId={ctx.household.id} />
      <GroupList groups={groups} />
    </div>
  );
}
