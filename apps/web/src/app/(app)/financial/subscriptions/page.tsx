/**
 * `/financial/subscriptions` — detected recurring charges.
 *
 * Server Component. Populated from `mem.node where type='subscription'`.
 */

import { SubscriptionRow } from '@/components/financial/SubscriptionRow';
import { getHouseholdContext } from '@/lib/auth/context';
import { listSubscriptions, type SegmentGrant } from '@/lib/financial';

export default async function SubscriptionsPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;
  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));
  const subscriptions = await listSubscriptions({ householdId: ctx.household.id }, { grants });

  if (subscriptions.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
        No subscriptions detected yet. The subscription detector runs nightly after transactions
        sync.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {subscriptions.map((s) => (
        <SubscriptionRow key={s.id} subscription={s} />
      ))}
    </div>
  );
}
