/**
 * Unit tests for `generateMealSwapSuggestions`.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  EXPIRING_SOON_DAYS,
  MEAL_SWAP_HORIZON_DAYS,
  generateMealSwapSuggestions,
} from './meal-swap.js';

const HOUSEHOLD = 'h-1';

describe('generateMealSwapSuggestions', () => {
  const now = new Date('2026-04-20T12:00:00Z');

  it('emits a swap for an expiring ingredient with a matching dish', async () => {
    const out = await generateMealSwapSuggestions({
      householdId: HOUSEHOLD,
      now,
      meals: [
        {
          id: 'm-1',
          household_id: HOUSEHOLD,
          planned_for: '2026-04-21',
          slot: 'dinner',
          title: 'Takeout',
          dish_node_id: null,
          status: 'planned',
        },
      ],
      pantryItems: [
        {
          id: 'p-1',
          household_id: HOUSEHOLD,
          name: 'Spinach',
          quantity: 1,
          unit: 'bag',
          expires_on: '2026-04-21',
          location: 'fridge',
        },
      ],
      dishes: [
        {
          id: 'd-1',
          household_id: HOUSEHOLD,
          canonical_name: 'Spinach Pasta',
          metadata: {},
          created_at: '2025-01-01T00:00:00Z',
        },
      ],
      dishIngredientEdges: [
        {
          household_id: HOUSEHOLD,
          dish_node_id: 'd-1',
          ingredient_node_id: 'i-1',
          ingredient_name: 'Spinach',
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('meal_swap');
    expect(out[0]!.preview.target_meal_id).toBe('m-1');
    expect(out[0]!.preview.suggested_dish_name).toBe('Spinach Pasta');
    expect(out[0]!.dedupeKey).toBe('meal_swap:m-1:spinach');
  });

  it('uses the rationale writer when supplied', async () => {
    const writer = vi.fn().mockResolvedValue('Polished rationale.');
    const out = await generateMealSwapSuggestions({
      householdId: HOUSEHOLD,
      now,
      meals: [
        {
          id: 'm-1',
          household_id: HOUSEHOLD,
          planned_for: '2026-04-21',
          slot: 'dinner',
          title: 'Takeout',
          dish_node_id: null,
          status: 'planned',
        },
      ],
      pantryItems: [
        {
          id: 'p-1',
          household_id: HOUSEHOLD,
          name: 'Spinach',
          quantity: 1,
          unit: 'bag',
          expires_on: '2026-04-21',
          location: 'fridge',
        },
      ],
      dishes: [
        {
          id: 'd-1',
          household_id: HOUSEHOLD,
          canonical_name: 'Spinach Pasta',
          metadata: {},
          created_at: '2025-01-01T00:00:00Z',
        },
      ],
      dishIngredientEdges: [
        {
          household_id: HOUSEHOLD,
          dish_node_id: 'd-1',
          ingredient_node_id: 'i-1',
          ingredient_name: 'Spinach',
        },
      ],
      rationaleWriter: writer,
    });
    expect(writer).toHaveBeenCalledTimes(1);
    expect(out[0]!.rationale).toBe('Polished rationale.');
  });

  it('returns empty when no expiring items exist', async () => {
    const out = await generateMealSwapSuggestions({
      householdId: HOUSEHOLD,
      now,
      meals: [],
      pantryItems: [],
      dishes: [],
      dishIngredientEdges: [],
    });
    expect(out).toEqual([]);
  });

  it('does not suggest swapping to a dish the meal already uses', async () => {
    const out = await generateMealSwapSuggestions({
      householdId: HOUSEHOLD,
      now,
      meals: [
        {
          id: 'm-1',
          household_id: HOUSEHOLD,
          planned_for: '2026-04-21',
          slot: 'dinner',
          title: 'Spinach Pasta',
          dish_node_id: 'd-1',
          status: 'planned',
        },
      ],
      pantryItems: [
        {
          id: 'p-1',
          household_id: HOUSEHOLD,
          name: 'Spinach',
          quantity: 1,
          unit: 'bag',
          expires_on: '2026-04-21',
          location: 'fridge',
        },
      ],
      dishes: [
        {
          id: 'd-1',
          household_id: HOUSEHOLD,
          canonical_name: 'Spinach Pasta',
          metadata: {},
          created_at: '2025-01-01T00:00:00Z',
        },
      ],
      dishIngredientEdges: [
        {
          household_id: HOUSEHOLD,
          dish_node_id: 'd-1',
          ingredient_node_id: 'i-1',
          ingredient_name: 'Spinach',
        },
      ],
    });
    expect(out).toEqual([]);
  });

  it('exports constants', () => {
    expect(MEAL_SWAP_HORIZON_DAYS).toBeGreaterThan(0);
    expect(EXPIRING_SOON_DAYS).toBeGreaterThan(0);
  });
});
