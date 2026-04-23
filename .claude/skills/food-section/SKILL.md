---
name: food-section
description: Populate data and add tabs/functionality in the Food section (/food). Use when the user wants to seed meals/pantry/grocery lists, add a new food tab (e.g. recipes, nutrition, shopping runs), wire a server action for meal planner or pantry writes, or expose a food tool to the Hermes chat agent.
---

# Food section

Meal planning, pantry, grocery lists, dish catalog.

## Surface area

- Route root: `apps/web/src/app/(app)/food/` with `layout.tsx` +
  `FoodSubNav`.
- Current tabs (see `apps/web/src/components/food/FoodSubNav.tsx`):
  Overview, Meal planner, Pantry, Groceries, Dishes, Calendar, Summaries,
  Alerts.
- Data tables (migration
  `packages/db/supabase/migrations/0006_food.sql`): `app.meal`,
  `app.pantry_item`, `app.grocery_list`, `app.grocery_list_item`.
- Components: `apps/web/src/components/food/*` (`MealPlannerGrid`,
  `PantryTable`, `GroceryListsView`, `FoodAlertsFeed`).
- Agent tools: `packages/tools/src/tools/food/*` —
  `addMealToPlan.ts`, `updateMeal.ts`, `removeMeal.ts`,
  `addPantryItem.ts`, `updatePantryItem.ts`, `removePantryItem.ts`,
  `draftMealPlan.ts`, `proposeGroceryOrder.ts`. Also top-level
  `listMeals.ts`, `getPantry.ts`, `getGroceryList.ts`.

## Populate data

1. **Local dev seed (SQL)** — extend `packages/db/supabase/seed.sql`.
   Seed order: `app.pantry_item` (no FKs beyond household) → `app.meal`
   (has `planned_for` date) → `app.grocery_list` → `app.grocery_list_item`.
   Use relative dates anchored on `current_date` so the seed stays
   perpetually fresh.
2. **Chat-driven** — food already has the richest tool surface; most are
   direct-write. Prefer reusing the existing handlers. To add a new kind
   (e.g. `logLeftover`, `rateMeal`), create a file under
   `packages/tools/src/tools/food/` and wire into `catalog.ts` +
   `defaultSet.ts`. Mirror the `z.object().strict()` schema style and the
   classification field from neighboring tools.
3. **UI write path** — server actions under
   `apps/web/src/app/actions/food/` (check existing ones before adding);
   revalidate `/food/<tab>` after writes. `FoodRealtimeRefresher` already
   reacts to Supabase realtime events.

## Add a tab

1. Create `apps/web/src/app/(app)/food/<tab>/page.tsx`.
2. Extend `Tab.href` union and `TABS` in `FoodSubNav.tsx`.
3. If the tab needs writes, add a client component + server action pair.
4. Wrap realtime-dependent UI in `FoodRealtimeRefresher` (already mounted
   at the layout level — confirm before double-wrapping).
5. Add a test (see `food/food.test.ts` in the tools package for the shape
   of write-path testing).

## Gotchas

- Pantry uses a unit enum; adding a new unit is a migration.
- Grocery items have a `checked_at` nullable timestamp, not a boolean —
  preserve that when serializing from handlers.
- Meal plan slots are keyed on `(household_id, planned_for, slot)`; upserts
  must use that composite conflict target.
