/**
 * `/food/meal-planner` — weekly planner with drag-drop.
 */

import { FoodRealtimeRefresher } from '@/components/food/FoodRealtimeRefresher';
import { MealPlannerGrid } from '@/components/food/MealPlannerGrid';
import { MealPlannerPantryBridge } from '@/components/food/MealPlannerPantryBridge';
import { getHouseholdContext } from '@/lib/auth/context';
import {
  getFoodProviderConnectionStatus,
  hasFoodWrite,
  listGroceryLists,
  listMeals,
  loadMealPlanPantrySummary,
  type SegmentGrant,
} from '@/lib/food';

function thisMondayUtc(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay();
  const offset = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

export default async function MealPlannerPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));
  const canWrite = hasFoodWrite(grants);

  const weekStart = thisMondayUtc(new Date());
  const weekEnd = new Date(`${weekStart}T00:00:00Z`);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const weekEndIso = weekEnd.toISOString().slice(0, 10);

  const [meals, pantrySummary, draftLists, instacart] = await Promise.all([
    listMeals(
      { householdId: ctx.household.id, from: weekStart, to: weekEndIso, limit: 200 },
      { grants },
    ),
    loadMealPlanPantrySummary(
      { householdId: ctx.household.id, from: weekStart, to: weekEndIso },
      { grants },
    ),
    listGroceryLists({ householdId: ctx.household.id, statuses: ['draft'], limit: 5 }, { grants }),
    getFoodProviderConnectionStatus(
      { householdId: ctx.household.id, provider: 'instacart' },
      { grants },
    ),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <FoodRealtimeRefresher householdId={ctx.household.id} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <MealPlannerGrid
          householdId={ctx.household.id}
          weekStartDate={weekStart}
          initial={meals}
          canWrite={canWrite}
        />
        <MealPlannerPantryBridge
          householdId={ctx.household.id}
          weekStartDate={weekStart}
          weekEndDate={weekEndIso}
          summary={pantrySummary}
          draftLists={draftLists}
          instacart={instacart}
          canWrite={canWrite}
        />
      </div>
    </div>
  );
}
