/**
 * `new_dish` suggestion generator.
 *
 * When a dish appears >`DISH_REPEAT_THRESHOLD` times in the trailing
 * `NEW_DISH_LOOKBACK_DAYS` days, suggest trying something new. The
 * deterministic picker sorts the household's other dishes by
 * least-recently-served (from `mem.node.metadata.last_served_at` if
 * present, falling back to `created_at`) and emits the top candidate.
 *
 * Dedupe key: `new_dish:${tiredDishName}`.
 */

import { type RationaleWriter, type SuggestionEmission } from '../types.js';

import { type DishNode, type MealRow } from './types.js';

export const DISH_REPEAT_THRESHOLD = 3;
export const NEW_DISH_LOOKBACK_DAYS = 30;

export interface NewDishInput {
  householdId: string;
  meals: MealRow[];
  dishes: DishNode[];
  now: Date;
}

export interface GenerateNewDishArgs extends NewDishInput {
  rationaleWriter?: RationaleWriter;
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

export async function generateNewDishSuggestions(
  args: GenerateNewDishArgs,
): Promise<SuggestionEmission[]> {
  const cutoffMs = args.now.getTime() - NEW_DISH_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  // Count dish occurrences in the lookback window. Key on
  // (dish_node_id ?? normalized(title)) so both linked and free-typed
  // meals are counted.
  const byKey = new Map<string, { count: number; dishNodeId: string | null; label: string }>();
  for (const meal of args.meals) {
    if (meal.household_id !== args.householdId) continue;
    if (meal.status === 'skipped') continue;
    const plannedMs = Date.parse(`${meal.planned_for.slice(0, 10)}T00:00:00.000Z`);
    if (!Number.isFinite(plannedMs) || plannedMs < cutoffMs) continue;

    const key = meal.dish_node_id ?? normalize(meal.title);
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      byKey.set(key, {
        count: 1,
        dishNodeId: meal.dish_node_id,
        label: meal.title,
      });
    }
  }

  const tiredDishes = [...byKey.entries()]
    .filter(([, v]) => v.count > DISH_REPEAT_THRESHOLD)
    .sort((a, b) => b[1].count - a[1].count);

  if (tiredDishes.length === 0) return [];

  // Pick an alternate dish: the household's other dishes, oldest-first
  // (proxy for "least recently suggested"). Exclude anything already
  // tired.
  const tiredLabels = new Set<string>();
  for (const [, v] of tiredDishes) tiredLabels.add(normalize(v.label));
  const householdDishes = args.dishes
    .filter((d) => d.household_id === args.householdId)
    .filter((d) => !tiredLabels.has(normalize(d.canonical_name)))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  if (householdDishes.length === 0) return [];

  const out: SuggestionEmission[] = [];
  // One suggestion per tired dish, capped at 3 to keep card spam low.
  for (const [, tired] of tiredDishes.slice(0, 3)) {
    const alt = householdDishes[0];
    if (!alt) continue;
    const fallback = `${tired.label} has appeared ${tired.count} times in the last 30 days. Try ${alt.canonical_name} for variety.`;
    const rationale = args.rationaleWriter
      ? await args.rationaleWriter({
          kind: 'new_dish',
          candidate: {
            tired_dish: tired.label,
            repeat_count: tired.count,
            suggested_dish: alt.canonical_name,
          },
          fallback,
        })
      : fallback;

    out.push({
      segment: 'food',
      kind: 'new_dish',
      title: `Try ${alt.canonical_name} instead of ${tired.label}`,
      rationale,
      preview: {
        tired_dish_label: tired.label,
        tired_dish_node_id: tired.dishNodeId,
        repeat_count_30d: tired.count,
        suggested_dish_node_id: alt.id,
        suggested_dish_name: alt.canonical_name,
        dedupe_key: `new_dish:${normalize(tired.label)}`,
      },
      dedupeKey: `new_dish:${normalize(tired.label)}`,
    });
  }
  return out;
}
