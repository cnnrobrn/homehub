/**
 * `meal_swap` suggestion generator.
 *
 * For each planned meal in the next `MEAL_SWAP_HORIZON_DAYS` days, look
 * for pantry items expiring within `EXPIRING_SOON_DAYS` days. If a
 * matching dish exists that uses those items (via `mem.edge` of type
 * `contains`), emit a swap suggestion.
 *
 * The deterministic selection picks:
 *   - the earliest upcoming meal that isn't already using the
 *     expiring ingredient, and
 *   - the highest-weighted dish whose `contains` edges include the
 *     expiring ingredient.
 *
 * Dedupe key: `meal_swap:${targetMealId}:${expiringIngredientName}`.
 */

import { type RationaleWriter, type SuggestionEmission } from '../types.js';

import {
  type DishIngredientEdge,
  type DishNode,
  type MealRow,
  type PantryItemRow,
} from './types.js';

export const MEAL_SWAP_HORIZON_DAYS = 7;
export const EXPIRING_SOON_DAYS = 2;

export interface MealSwapInput {
  householdId: string;
  meals: MealRow[];
  pantryItems: PantryItemRow[];
  dishes: DishNode[];
  /** `dish --contains-> ingredient` edges. */
  dishIngredientEdges: DishIngredientEdge[];
  now: Date;
}

export interface GenerateMealSwapArgs extends MealSwapInput {
  rationaleWriter?: RationaleWriter;
}

interface SwapCandidate {
  targetMeal: MealRow;
  expiringIngredient: string;
  pantryItemId: string;
  suggestedDish: DishNode;
  daysUntilExpiry: number;
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

export async function generateMealSwapSuggestions(
  args: GenerateMealSwapArgs,
): Promise<SuggestionEmission[]> {
  const nowMs = args.now.getTime();
  const horizonMs = MEAL_SWAP_HORIZON_DAYS * 24 * 60 * 60 * 1000;
  const expiringCutoffMs = nowMs + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000;

  // ---- Pantry items that expire in the next 2 days --------------------
  const expiring = args.pantryItems
    .filter((p) => p.household_id === args.householdId)
    .filter((p) => {
      if (!p.expires_on) return false;
      const ms = Date.parse(`${p.expires_on}T00:00:00.000Z`);
      return Number.isFinite(ms) && ms >= nowMs - 24 * 60 * 60 * 1000 && ms <= expiringCutoffMs;
    });

  if (expiring.length === 0) return [];

  // ---- Upcoming planned meals ----------------------------------------
  const upcomingMeals = args.meals
    .filter((m) => m.household_id === args.householdId)
    .filter((m) => m.status === 'planned')
    .filter((m) => {
      const ms = Date.parse(`${m.planned_for.slice(0, 10)}T00:00:00.000Z`);
      return Number.isFinite(ms) && ms >= nowMs && ms <= nowMs + horizonMs;
    })
    .sort((a, b) => a.planned_for.localeCompare(b.planned_for));

  if (upcomingMeals.length === 0) return [];

  // ---- Build dish-by-ingredient lookup -------------------------------
  const dishById = new Map(args.dishes.map((d) => [d.id, d]));
  const dishesByIngredient = new Map<string, Set<string>>();
  for (const edge of args.dishIngredientEdges) {
    if (edge.household_id !== args.householdId) continue;
    const key = normalize(edge.ingredient_name);
    if (!dishesByIngredient.has(key)) dishesByIngredient.set(key, new Set());
    dishesByIngredient.get(key)!.add(edge.dish_node_id);
  }

  // Deterministic candidate selection.
  const candidates: SwapCandidate[] = [];
  const usedMeals = new Set<string>();

  for (const pantry of expiring) {
    const key = normalize(pantry.name);
    const dishIds = dishesByIngredient.get(key);
    if (!dishIds || dishIds.size === 0) continue;

    // Find a meal that doesn't already point at this dish.
    const target = upcomingMeals.find(
      (m) => !usedMeals.has(m.id) && (m.dish_node_id === null || !dishIds.has(m.dish_node_id)),
    );
    if (!target) continue;

    // Pick the oldest (canonical) dish by created_at, deterministic.
    const matched = [...dishIds]
      .map((id) => dishById.get(id))
      .filter((d): d is DishNode => Boolean(d))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const suggestedDish = matched[0];
    if (!suggestedDish) continue;

    const expiryMs = Date.parse(`${pantry.expires_on}T00:00:00.000Z`);
    const daysUntilExpiry = Math.max(0, Math.round((expiryMs - nowMs) / (24 * 60 * 60 * 1000)));
    candidates.push({
      targetMeal: target,
      expiringIngredient: pantry.name,
      pantryItemId: pantry.id,
      suggestedDish,
      daysUntilExpiry,
    });
    usedMeals.add(target.id);
  }

  const out: SuggestionEmission[] = [];
  for (const c of candidates) {
    const fallbackRationale = `${c.expiringIngredient} in your pantry expires ${c.daysUntilExpiry === 0 ? 'today' : c.daysUntilExpiry === 1 ? 'tomorrow' : `in ${c.daysUntilExpiry} days`}. Swapping your ${c.targetMeal.slot} on ${c.targetMeal.planned_for.slice(0, 10)} for ${c.suggestedDish.canonical_name} uses it before it spoils.`;

    const rationale = args.rationaleWriter
      ? await args.rationaleWriter({
          kind: 'meal_swap',
          candidate: {
            expiring_ingredient: c.expiringIngredient,
            days_until_expiry: c.daysUntilExpiry,
            current_meal_title: c.targetMeal.title,
            suggested_dish_name: c.suggestedDish.canonical_name,
          },
          fallback: fallbackRationale,
        })
      : fallbackRationale;

    out.push({
      segment: 'food',
      kind: 'meal_swap',
      title: `Swap ${c.targetMeal.slot} to ${c.suggestedDish.canonical_name}`,
      rationale,
      preview: {
        target_meal_id: c.targetMeal.id,
        target_planned_for: c.targetMeal.planned_for.slice(0, 10),
        target_slot: c.targetMeal.slot,
        current_title: c.targetMeal.title,
        suggested_dish_node_id: c.suggestedDish.id,
        suggested_dish_name: c.suggestedDish.canonical_name,
        expiring_ingredient: c.expiringIngredient,
        pantry_item_id: c.pantryItemId,
        days_until_expiry: c.daysUntilExpiry,
        dedupe_key: `meal_swap:${c.targetMeal.id}:${normalize(c.expiringIngredient)}`,
      },
      dedupeKey: `meal_swap:${c.targetMeal.id}:${normalize(c.expiringIngredient)}`,
    });
  }
  return out;
}
