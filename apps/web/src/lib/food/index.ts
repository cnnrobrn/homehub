/**
 * Food segment server helpers.
 *
 * All readers run under the authed RLS-enforced Supabase client and
 * short-circuit on `food:read` before issuing queries. Never import
 * from Client Components — data should flow via props or server
 * actions.
 */

export {
  GROCERY_STATUSES,
  MEAL_SLOTS,
  MEAL_STATUSES,
  PANTRY_LOCATIONS,
  hasFoodRead,
  hasFoodWrite,
  type GroceryStatus,
  type MealSlot,
  type MealStatus,
  type PantryLocation,
  type SegmentGrant,
} from './types';

export { listMeals, listMealsArgsSchema, type ListMealsArgs, type MealRow } from './listMeals';

export {
  listPantryItems,
  listPantryItemsArgsSchema,
  type ListPantryItemsArgs,
  type PantryItemRow,
} from './listPantryItems';

export {
  listGroceryLists,
  listGroceryListsArgsSchema,
  type GroceryListItemRow,
  type GroceryListRow,
  type ListGroceryListsArgs,
} from './listGroceryLists';

export {
  FOOD_ALERT_SEVERITIES,
  listFoodAlerts,
  listFoodAlertsArgsSchema,
  type FoodAlertRow,
  type FoodAlertSeverity,
  type ListFoodAlertsArgs,
} from './listFoodAlerts';

export {
  listFoodSummaries,
  listFoodSummariesArgsSchema,
  type FoodSummaryRow,
  type ListFoodSummariesArgs,
} from './listFoodSummaries';

export { listDishes, listDishesArgsSchema, type DishRow, type ListDishesArgs } from './listDishes';

export {
  listFoodSuggestions,
  listFoodSuggestionsArgsSchema,
  type FoodSuggestionRow,
  type ListFoodSuggestionsArgs,
} from './listFoodSuggestions';
