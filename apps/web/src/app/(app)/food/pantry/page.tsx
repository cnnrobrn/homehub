/**
 * `/food/pantry` — inventory table.
 */

import { FoodRealtimeRefresher } from '@/components/food/FoodRealtimeRefresher';
import { PantryTable } from '@/components/food/PantryTable';
import { getHouseholdContext } from '@/lib/auth/context';
import { hasFoodWrite, listPantryItems, type SegmentGrant } from '@/lib/food';

export default async function PantryPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;
  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));
  const canWrite = hasFoodWrite(grants);
  const items = await listPantryItems({ householdId: ctx.household.id, limit: 500 }, { grants });
  return (
    <div className="flex flex-col gap-4">
      <FoodRealtimeRefresher householdId={ctx.household.id} />
      <PantryTable householdId={ctx.household.id} initial={items} canWrite={canWrite} />
    </div>
  );
}
