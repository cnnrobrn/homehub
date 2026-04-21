/**
 * `meal_plan_gap` detector.
 *
 * Emits one `info` alert per day in the next `MEAL_PLAN_HORIZON_DAYS`
 * where there's no meal planned in the dinner slot *and* the household
 * has pantry items on hand (so the hint is actionable — "you've got
 * stuff but no plan").
 *
 * Dedupe key: `${date}-dinner` so the alert stays idempotent inside the
 * 24h dedupe window and fires fresh the next day.
 */

import { type AlertEmission } from '../types.js';

import { type MealRow, type PantryItemRow } from './types.js';

export const MEAL_PLAN_HORIZON_DAYS = 7;

export interface MealPlanGapInput {
  householdId: string;
  meals: MealRow[];
  pantryItems: PantryItemRow[];
  now: Date;
}

function toDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function detectMealPlanGap(input: MealPlanGapInput): AlertEmission[] {
  const pantryCount = input.pantryItems.filter((p) => p.household_id === input.householdId).length;
  // Only surface gap alerts when the household has inventory — otherwise
  // the suggestion to "plan dinner" is just noise.
  if (pantryCount === 0) return [];

  const dinnerByDate = new Set<string>();
  for (const meal of input.meals) {
    if (meal.household_id !== input.householdId) continue;
    if (meal.slot !== 'dinner') continue;
    // Normalise planned_for (stored as date). Some DBs hand us a
    // full ISO timestamp; take the first 10 chars.
    const key = meal.planned_for.slice(0, 10);
    dinnerByDate.add(key);
  }

  const out: AlertEmission[] = [];
  const base = new Date(
    Date.UTC(input.now.getUTCFullYear(), input.now.getUTCMonth(), input.now.getUTCDate()),
  );
  for (let offset = 0; offset < MEAL_PLAN_HORIZON_DAYS; offset += 1) {
    const target = new Date(base);
    target.setUTCDate(target.getUTCDate() + offset);
    const dateKey = toDateKey(target);
    if (dinnerByDate.has(dateKey)) continue;

    const phrasing =
      offset === 0
        ? 'tonight'
        : offset === 1
          ? 'tomorrow night'
          : target.toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
              timeZone: 'UTC',
            });
    out.push({
      segment: 'food',
      severity: 'info',
      kind: 'meal_plan_gap',
      dedupeKey: `${dateKey}-dinner`,
      title: `No dinner planned ${phrasing}`,
      body: `You've got ${pantryCount} pantry item${pantryCount === 1 ? '' : 's'} on hand but nothing scheduled for dinner ${phrasing}. Want to draft a meal?`,
      context: {
        date: dateKey,
        slot: 'dinner',
        pantry_item_count: pantryCount,
      },
    });
  }
  return out;
}
