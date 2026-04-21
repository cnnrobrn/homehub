/**
 * `/social/people/[personId]` — person detail page.
 */

import { notFound } from 'next/navigation';

import { PersonDetail } from '@/components/social/PersonDetail';
import { SocialRealtimeRefresher } from '@/components/social/SocialRealtimeRefresher';
import { getHouseholdContext } from '@/lib/auth/context';
import { getPersonDetail, type SegmentGrant } from '@/lib/social';

export interface PersonPageProps {
  params: Promise<{ personId: string }>;
}

export default async function PersonPage({ params }: PersonPageProps) {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;
  const { personId } = await params;

  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));
  const detail = await getPersonDetail(
    { householdId: ctx.household.id, personNodeId: personId },
    { grants },
  );
  if (!detail) notFound();

  return (
    <div className="flex flex-col gap-4">
      <SocialRealtimeRefresher householdId={ctx.household.id} />
      <PersonDetail detail={detail} />
    </div>
  );
}
