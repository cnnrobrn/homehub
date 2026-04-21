/**
 * Shared row shapes for the food alert detectors.
 *
 * The detectors mirror `packages/alerts/src/types.ts` for the financial
 * side: pure functions over in-memory inputs, zero DB access, zero model
 * calls. The alerts worker is the only caller.
 */

/** Subset of `app.pantry_item.Row` food detectors consume. */
export interface PantryItemRow {
  id: string;
  household_id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  /** ISO date (YYYY-MM-DD) or null. */
  expires_on: string | null;
  location: string | null;
  last_seen_at: string | null;
}

/** Subset of `app.meal.Row`. */
export interface MealRow {
  id: string;
  household_id: string;
  /** ISO date (YYYY-MM-DD). */
  planned_for: string;
  slot: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  title: string;
  dish_node_id: string | null;
  status: 'planned' | 'cooking' | 'served' | 'skipped';
  servings: number | null;
  cook_member_id: string | null;
}

/** Subset of `app.grocery_list.Row`. */
export interface GroceryListRow {
  id: string;
  household_id: string;
  planned_for: string | null;
  status: 'draft' | 'ordered' | 'received' | 'cancelled';
  provider: string | null;
  external_order_id: string | null;
  updated_at: string;
  created_at: string;
}
