/**
 * Shared row shapes for the food suggestion generators.
 *
 * Kept distinct from `@homehub/alerts` food types (though the shapes
 * often overlap) so the two packages stay independent.
 */

export interface PantryItemRow {
  id: string;
  household_id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  /** ISO date (YYYY-MM-DD) or null. */
  expires_on: string | null;
  location: string | null;
}

export interface MealRow {
  id: string;
  household_id: string;
  /** ISO date (YYYY-MM-DD). */
  planned_for: string;
  slot: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  title: string;
  dish_node_id: string | null;
  status: 'planned' | 'cooking' | 'served' | 'skipped';
}

/** Subset of `mem.node` for type='dish' rows. */
export interface DishNode {
  id: string;
  household_id: string;
  canonical_name: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

/** Subset of `mem.edge` for `dish --contains-> ingredient` edges. */
export interface DishIngredientEdge {
  household_id: string;
  dish_node_id: string;
  ingredient_node_id: string;
  ingredient_name: string;
}

export interface PantryDeficit {
  name: string;
  /** Canonical quantity; null if the source meal has no measurement. */
  quantity: number | null;
  unit: string | null;
  /** Meal IDs that contributed to the deficit, for provenance. */
  sourceMealIds: string[];
}
