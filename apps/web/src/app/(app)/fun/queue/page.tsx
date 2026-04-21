/**
 * `/fun/queue` — household "books / shows / games to do" list.
 */

import { CreateQueueItemForm } from '@/components/fun/CreateQueueItemForm';
import { QueueList } from '@/components/fun/QueueList';
import { getHouseholdContext } from '@/lib/auth/context';
import { hasFunWrite, listQueueItems, type SegmentGrant } from '@/lib/fun';

export default async function QueuePage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));

  const items = await listQueueItems({ householdId: ctx.household.id }, { grants });

  return (
    <div className="flex flex-col gap-4">
      {hasFunWrite(grants) ? (
        <CreateQueueItemForm householdId={ctx.household.id} />
      ) : (
        <div className="rounded-lg border border-border bg-surface p-3 text-xs text-fg-muted">
          You have read-only access to Fun. Ask an owner for write access to add items.
        </div>
      )}
      <QueueList items={items} />
    </div>
  );
}
