/**
 * Meal-plan ↔ pantry bridge.
 *
 * Builds the same member-facing view the pantry-diff worker implies:
 * planned meals resolve to dish ingredients, current pantry inventory is
 * subtracted, and the remainder becomes an Instacart-ready draft list.
 */

import { type Database, type Json } from '@homehub/db';
import { z } from 'zod';

import { listMeals, type MealRow } from './listMeals';
import { listPantryItems, type PantryItemRow } from './listPantryItems';
import { hasFoodRead, type SegmentGrant } from './types';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const loadMealPlanPantrySummaryArgsSchema = z.object({
  householdId: z.string().uuid(),
  from: isoDate,
  to: isoDate,
});

export type LoadMealPlanPantrySummaryArgs = z.infer<typeof loadMealPlanPantrySummaryArgsSchema>;

export interface MealPlanIngredient {
  name: string;
  quantity: number | null;
  unit: string | null;
}

export interface MealPlanGroceryItem {
  name: string;
  neededQuantity: number | null;
  pantryQuantity: number | null;
  shortageQuantity: number | null;
  unit: string | null;
  sourceMealIds: string[];
  sourceMealTitles: string[];
  coverage: 'missing' | 'partial' | 'covered';
}

export interface MealPlanUnresolvedMeal {
  id: string;
  title: string;
  plannedFor: string;
  slot: string;
  reason: 'no_dish' | 'no_ingredients';
}

export interface MealPlanPantrySummary {
  missingItems: MealPlanGroceryItem[];
  coveredItems: MealPlanGroceryItem[];
  unresolvedMeals: MealPlanUnresolvedMeal[];
  mealCount: number;
  pantryItemCount: number;
  ingredientCount: number;
}

type DishIngredientsById = Map<string, MealPlanIngredient[]>;

type NodeRow = Pick<Database['mem']['Tables']['node']['Row'], 'id' | 'canonical_name' | 'metadata'>;
type EdgeRow = Pick<Database['mem']['Tables']['edge']['Row'], 'src_id' | 'dst_id'>;

interface LoadMealPlanPantrySummaryDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
}

interface IngredientAccumulator {
  displayName: string;
  quantities: Array<{ quantity: number | null; unit: string | null }>;
  mealIds: string[];
  mealTitles: string[];
}

interface PantryAccumulator {
  quantities: Array<{ quantity: number | null; unit: string | null }>;
}

function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function addUnique(target: string[], value: string): void {
  if (!target.includes(value)) target.push(value);
}

function coerceIngredient(raw: unknown): MealPlanIngredient | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.name !== 'string' || candidate.name.trim().length === 0) return null;
  return {
    name: candidate.name.trim(),
    quantity:
      typeof candidate.quantity === 'number' && candidate.quantity > 0 ? candidate.quantity : null,
    unit:
      typeof candidate.unit === 'string' && candidate.unit.trim() ? candidate.unit.trim() : null,
  };
}

function metadataIngredients(metadata: Json): MealPlanIngredient[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  const raw = (metadata as Record<string, unknown>).ingredients;
  if (!Array.isArray(raw)) return [];
  return raw.map(coerceIngredient).filter((i): i is MealPlanIngredient => i !== null);
}

function collapseQuantities(quantities: Array<{ quantity: number | null; unit: string | null }>): {
  quantity: number | null;
  unit: string | null;
} {
  const measured = quantities.filter((q) => q.quantity !== null && q.unit !== null) as Array<{
    quantity: number;
    unit: string;
  }>;
  if (measured.length === 0) {
    const unitOnly = quantities.find((q) => q.unit !== null)?.unit ?? null;
    return { quantity: null, unit: unitOnly };
  }
  const firstUnit = measured[0]!.unit;
  if (!measured.every((q) => q.unit === firstUnit)) {
    return { quantity: null, unit: null };
  }
  return {
    quantity: measured.reduce((sum, q) => sum + q.quantity, 0),
    unit: firstUnit,
  };
}

function pantryQuantityForUnit(
  pantry: PantryAccumulator | undefined,
  unit: string | null,
): number | null {
  if (!pantry || !unit) return null;
  const matching = pantry.quantities.filter(
    (q) => q.unit === unit && q.quantity !== null,
  ) as Array<{
    quantity: number;
    unit: string;
  }>;
  if (matching.length === 0) return null;
  return matching.reduce((sum, q) => sum + q.quantity, 0);
}

export function buildMealPlanPantrySummary(input: {
  meals: readonly MealRow[];
  pantryItems: readonly PantryItemRow[];
  ingredientsByDish: DishIngredientsById;
}): MealPlanPantrySummary {
  const requested = new Map<string, IngredientAccumulator>();
  const unresolvedMeals: MealPlanUnresolvedMeal[] = [];

  for (const meal of input.meals) {
    if (!meal.dishNodeId) {
      unresolvedMeals.push({
        id: meal.id,
        title: meal.title,
        plannedFor: meal.plannedFor,
        slot: meal.slot,
        reason: 'no_dish',
      });
      continue;
    }

    const ingredients = input.ingredientsByDish.get(meal.dishNodeId) ?? [];
    if (ingredients.length === 0) {
      unresolvedMeals.push({
        id: meal.id,
        title: meal.title,
        plannedFor: meal.plannedFor,
        slot: meal.slot,
        reason: 'no_ingredients',
      });
      continue;
    }

    for (const ingredient of ingredients) {
      const key = normalizeName(ingredient.name);
      if (!key) continue;
      const existing = requested.get(key);
      if (existing) {
        existing.quantities.push({ quantity: ingredient.quantity, unit: ingredient.unit });
        addUnique(existing.mealIds, meal.id);
        addUnique(existing.mealTitles, meal.title);
      } else {
        requested.set(key, {
          displayName: ingredient.name,
          quantities: [{ quantity: ingredient.quantity, unit: ingredient.unit }],
          mealIds: [meal.id],
          mealTitles: [meal.title],
        });
      }
    }
  }

  const pantry = new Map<string, PantryAccumulator>();
  for (const item of input.pantryItems) {
    const key = normalizeName(item.name);
    if (!key) continue;
    const existing = pantry.get(key);
    if (existing) {
      existing.quantities.push({ quantity: item.quantity, unit: item.unit });
    } else {
      pantry.set(key, {
        quantities: [{ quantity: item.quantity, unit: item.unit }],
      });
    }
  }

  const missingItems: MealPlanGroceryItem[] = [];
  const coveredItems: MealPlanGroceryItem[] = [];

  for (const [key, entry] of requested) {
    const needed = collapseQuantities(entry.quantities);
    const pantryEntry = pantry.get(key);
    const pantryQuantity = pantryQuantityForUnit(pantryEntry, needed.unit);

    let item: MealPlanGroceryItem;
    if (!pantryEntry) {
      item = {
        name: entry.displayName,
        neededQuantity: needed.quantity,
        pantryQuantity: null,
        shortageQuantity: needed.quantity,
        unit: needed.unit,
        sourceMealIds: entry.mealIds,
        sourceMealTitles: entry.mealTitles,
        coverage: 'missing',
      };
      missingItems.push(item);
      continue;
    }

    if (needed.quantity !== null && pantryQuantity !== null && pantryQuantity < needed.quantity) {
      item = {
        name: entry.displayName,
        neededQuantity: needed.quantity,
        pantryQuantity,
        shortageQuantity: needed.quantity - pantryQuantity,
        unit: needed.unit,
        sourceMealIds: entry.mealIds,
        sourceMealTitles: entry.mealTitles,
        coverage: 'partial',
      };
      missingItems.push(item);
      continue;
    }

    item = {
      name: entry.displayName,
      neededQuantity: needed.quantity,
      pantryQuantity,
      shortageQuantity: 0,
      unit: needed.unit,
      sourceMealIds: entry.mealIds,
      sourceMealTitles: entry.mealTitles,
      coverage: 'covered',
    };
    coveredItems.push(item);
  }

  const byName = (a: MealPlanGroceryItem, b: MealPlanGroceryItem) => a.name.localeCompare(b.name);

  return {
    missingItems: missingItems.sort(byName),
    coveredItems: coveredItems.sort(byName),
    unresolvedMeals,
    mealCount: input.meals.length,
    pantryItemCount: input.pantryItems.length,
    ingredientCount: requested.size,
  };
}

async function loadIngredientsByDish(
  client: ServerSupabaseClient,
  householdId: string,
  dishNodeIds: string[],
): Promise<DishIngredientsById> {
  const out: DishIngredientsById = new Map();
  if (dishNodeIds.length === 0) return out;

  const { data: dishRows, error: dishErr } = await client
    .schema('mem')
    .from('node')
    .select('id, canonical_name, metadata')
    .eq('household_id', householdId)
    .in('id', dishNodeIds);
  if (dishErr) throw new Error(`loadMealPlanPantrySummary dishes: ${dishErr.message}`);
  const dishes = (dishRows ?? []) as NodeRow[];

  const { data: edgeRows, error: edgeErr } = await client
    .schema('mem')
    .from('edge')
    .select('src_id, dst_id')
    .eq('household_id', householdId)
    .eq('type', 'contains')
    .in('src_id', dishNodeIds);
  if (edgeErr) throw new Error(`loadMealPlanPantrySummary edges: ${edgeErr.message}`);
  const edges = (edgeRows ?? []) as EdgeRow[];

  const ingredientIds = [...new Set(edges.map((edge) => edge.dst_id))];
  const ingredientNameById = new Map<string, string>();
  if (ingredientIds.length > 0) {
    const { data: ingredientRows, error: ingredientErr } = await client
      .schema('mem')
      .from('node')
      .select('id, canonical_name, metadata')
      .eq('household_id', householdId)
      .in('id', ingredientIds);
    if (ingredientErr) {
      throw new Error(`loadMealPlanPantrySummary ingredients: ${ingredientErr.message}`);
    }
    for (const row of (ingredientRows ?? []) as NodeRow[]) {
      ingredientNameById.set(row.id, row.canonical_name);
    }
  }

  for (const dish of dishes) {
    const ingredients: MealPlanIngredient[] = [];
    for (const edge of edges) {
      if (edge.src_id !== dish.id) continue;
      const name = ingredientNameById.get(edge.dst_id);
      if (name) ingredients.push({ name, quantity: null, unit: null });
    }
    ingredients.push(...metadataIngredients(dish.metadata));
    out.set(dish.id, ingredients);
  }

  return out;
}

export async function loadMealPlanPantrySummary(
  args: LoadMealPlanPantrySummaryArgs,
  deps: LoadMealPlanPantrySummaryDeps = {},
): Promise<MealPlanPantrySummary> {
  const parsed = loadMealPlanPantrySummaryArgsSchema.parse(args);
  if (deps.grants && !hasFoodRead(deps.grants)) {
    return {
      missingItems: [],
      coveredItems: [],
      unresolvedMeals: [],
      mealCount: 0,
      pantryItemCount: 0,
      ingredientCount: 0,
    };
  }

  const client = deps.client ?? (await createClient());
  const readerDeps = deps.grants ? { client, grants: deps.grants } : { client };
  const [meals, pantryItems] = await Promise.all([
    listMeals(
      { householdId: parsed.householdId, from: parsed.from, to: parsed.to, limit: 200 },
      readerDeps,
    ),
    listPantryItems({ householdId: parsed.householdId, limit: 500 }, readerDeps),
  ]);

  const dishNodeIds = [
    ...new Set(meals.map((meal) => meal.dishNodeId).filter(Boolean)),
  ] as string[];
  const ingredientsByDish = await loadIngredientsByDish(client, parsed.householdId, dishNodeIds);

  return buildMealPlanPantrySummary({ meals, pantryItems, ingredientsByDish });
}
