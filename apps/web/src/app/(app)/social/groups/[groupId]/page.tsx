/**
 * `/social/groups/[groupId]` — group detail page.
 */

import { notFound } from 'next/navigation';

import { GroupDetailView } from '@/components/social/GroupDetailView';
import { SocialRealtimeRefresher } from '@/components/social/SocialRealtimeRefresher';
import { getHouseholdContext } from '@/lib/auth/context';
import { getGroupDetail, type SegmentGrant } from '@/lib/social';

export interface GroupPageProps {
  params: Promise<{ groupId: string }>;
}

export default async function GroupPage({ params }: GroupPageProps) {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;
  const { groupId } = await params;
  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));
  const detail = await getGroupDetail(
    { householdId: ctx.household.id, groupNodeId: groupId },
    { grants },
  );
  if (!detail) notFound();
  return (
    <div className="flex flex-col gap-4">
      <SocialRealtimeRefresher householdId={ctx.household.id} />
      <GroupDetailView detail={detail} />
    </div>
  );
}
