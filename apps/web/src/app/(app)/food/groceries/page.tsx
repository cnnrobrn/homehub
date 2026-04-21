/**
 * `/food/groceries` — current + past grocery lists + approval surface.
 */

import { FoodRealtimeRefresher } from '@/components/food/FoodRealtimeRefresher';
import { GroceryListsView } from '@/components/food/GroceryListsView';
import { getHouseholdContext } from '@/lib/auth/context';
import { listFoodSuggestions, listGroceryLists, type SegmentGrant } from '@/lib/food';

export default async function GroceriesPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;
  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));
  const [lists, suggestions] = await Promise.all([
    listGroceryLists({ householdId: ctx.household.id, limit: 30 }, { grants }),
    listFoodSuggestions(
      { householdId: ctx.household.id, kinds: ['propose_grocery_order'], limit: 10 },
      { grants },
    ),
  ]);
  return (
    <div className="flex flex-col gap-4">
      <FoodRealtimeRefresher householdId={ctx.household.id} />
      <GroceryListsView lists={lists} pendingSuggestions={suggestions} />
    </div>
  );
}
