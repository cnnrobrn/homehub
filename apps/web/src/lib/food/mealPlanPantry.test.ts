/**
 * Tests for the meal-plan ↔ pantry summary rules.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { buildMealPlanPantrySummary, type MealPlanIngredient } from './mealPlanPantry';

import type { MealRow } from './listMeals';
import type { PantryItemRow } from './listPantryItems';

const HOUSEHOLD = '11111111-1111-4111-8111-111111111111';

function meal(overrides: Partial<MealRow> = {}): MealRow {
  return {
    id: 'meal-1',
    householdId: HOUSEHOLD,
    plannedFor: '2026-04-24',
    slot: 'dinner',
    title: 'Pasta night',
    dishNodeId: 'dish-1',
    cookMemberId: null,
    servings: 4,
    status: 'planned',
    notes: null,
    ...overrides,
  };
}

function pantry(overrides: Partial<PantryItemRow> = {}): PantryItemRow {
  return {
    id: 'pantry-1',
    householdId: HOUSEHOLD,
    name: 'Pasta noodles',
    quantity: 1,
    unit: 'lb',
    expiresOn: null,
    location: 'pantry',
    lastSeenAt: null,
    ...overrides,
  };
}

function ingredientsByDish(
  dishId: string,
  ingredients: MealPlanIngredient[],
): Map<string, MealPlanIngredient[]> {
  return new Map([[dishId, ingredients]]);
}

describe('buildMealPlanPantrySummary', () => {
  it('splits covered pantry items from missing grocery items', () => {
    const summary = buildMealPlanPantrySummary({
      meals: [meal()],
      pantryItems: [pantry()],
      ingredientsByDish: ingredientsByDish('dish-1', [
        { name: 'Pasta noodles', quantity: 1, unit: 'lb' },
        { name: 'Tomato sauce', quantity: 1, unit: 'jar' },
      ]),
    });

    expect(summary.coveredItems.map((item) => item.name)).toEqual(['Pasta noodles']);
    expect(summary.missingItems.map((item) => item.name)).toEqual(['Tomato sauce']);
    expect(summary.ingredientCount).toBe(2);
  });

  it('calculates partial shortages when units match', () => {
    const summary = buildMealPlanPantrySummary({
      meals: [meal()],
      pantryItems: [pantry({ quantity: 1, unit: 'lb' })],
      ingredientsByDish: ingredientsByDish('dish-1', [
        { name: 'Pasta noodles', quantity: 2, unit: 'lb' },
      ]),
    });

    expect(summary.missingItems).toHaveLength(1);
    expect(summary.missingItems[0]).toMatchObject({
      name: 'Pasta noodles',
      coverage: 'partial',
      neededQuantity: 2,
      pantryQuantity: 1,
      shortageQuantity: 1,
      unit: 'lb',
    });
  });

  it('reports meals without resolvable ingredients', () => {
    const summary = buildMealPlanPantrySummary({
      meals: [
        meal({ id: 'free-text', dishNodeId: null, title: 'Pizza night' }),
        meal({ id: 'empty-dish', dishNodeId: 'dish-empty', title: 'Mystery curry' }),
      ],
      pantryItems: [],
      ingredientsByDish: new Map([['dish-empty', []]]),
    });

    expect(summary.unresolvedMeals).toEqual([
      {
        id: 'free-text',
        title: 'Pizza night',
        plannedFor: '2026-04-24',
        slot: 'dinner',
        reason: 'no_dish',
      },
      {
        id: 'empty-dish',
        title: 'Mystery curry',
        plannedFor: '2026-04-24',
        slot: 'dinner',
        reason: 'no_ingredients',
      },
    ]);
  });
});
