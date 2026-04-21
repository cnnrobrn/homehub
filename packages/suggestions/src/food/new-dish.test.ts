/**
 * Unit tests for `generateNewDishSuggestions`.
 */

import { describe, expect, it } from 'vitest';

import {
  DISH_REPEAT_THRESHOLD,
  NEW_DISH_LOOKBACK_DAYS,
  generateNewDishSuggestions,
} from './new-dish.js';
import { type DishNode, type MealRow } from './types.js';

const HOUSEHOLD = 'h-1';

function meal(overrides: Partial<MealRow> & Pick<MealRow, 'id' | 'planned_for'>): MealRow {
  return {
    household_id: HOUSEHOLD,
    slot: 'dinner',
    title: 'Pasta',
    dish_node_id: null,
    status: 'planned',
    ...overrides,
  };
}

function dish(overrides: Partial<DishNode> & Pick<DishNode, 'id' | 'canonical_name'>): DishNode {
  return {
    household_id: HOUSEHOLD,
    metadata: {},
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('generateNewDishSuggestions', () => {
  const now = new Date('2026-04-20T12:00:00Z');

  it('emits a suggestion when a dish exceeds the repeat threshold', async () => {
    const out = await generateNewDishSuggestions({
      householdId: HOUSEHOLD,
      now,
      meals: [
        meal({ id: 'm-1', planned_for: '2026-04-05', title: 'Pasta' }),
        meal({ id: 'm-2', planned_for: '2026-04-08', title: 'Pasta' }),
        meal({ id: 'm-3', planned_for: '2026-04-12', title: 'Pasta' }),
        meal({ id: 'm-4', planned_for: '2026-04-15', title: 'Pasta' }),
      ],
      dishes: [dish({ id: 'd-alt', canonical_name: 'Tacos' })],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('new_dish');
    expect(out[0]!.preview.suggested_dish_name).toBe('Tacos');
    expect(out[0]!.dedupeKey).toBe('new_dish:pasta');
  });

  it('returns empty when no dish exceeds the threshold', async () => {
    const out = await generateNewDishSuggestions({
      householdId: HOUSEHOLD,
      now,
      meals: [
        meal({ id: 'm-1', planned_for: '2026-04-05', title: 'Pasta' }),
        meal({ id: 'm-2', planned_for: '2026-04-08', title: 'Pasta' }),
      ],
      dishes: [dish({ id: 'd-alt', canonical_name: 'Tacos' })],
    });
    expect(out).toEqual([]);
  });

  it('ignores meals outside the lookback window', async () => {
    const old = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const out = await generateNewDishSuggestions({
      householdId: HOUSEHOLD,
      now,
      meals: [
        meal({ id: 'm-1', planned_for: old, title: 'Pasta' }),
        meal({ id: 'm-2', planned_for: old, title: 'Pasta' }),
        meal({ id: 'm-3', planned_for: old, title: 'Pasta' }),
        meal({ id: 'm-4', planned_for: old, title: 'Pasta' }),
      ],
      dishes: [dish({ id: 'd-alt', canonical_name: 'Tacos' })],
    });
    expect(out).toEqual([]);
  });

  it('returns empty when no alternate dishes exist', async () => {
    const out = await generateNewDishSuggestions({
      householdId: HOUSEHOLD,
      now,
      meals: Array.from({ length: 4 }, (_, i) =>
        meal({ id: `m-${i}`, planned_for: '2026-04-10', title: 'Pasta' }),
      ),
      dishes: [],
    });
    expect(out).toEqual([]);
  });

  it('exports constants', () => {
    expect(DISH_REPEAT_THRESHOLD).toBeGreaterThan(0);
    expect(NEW_DISH_LOOKBACK_DAYS).toBeGreaterThan(0);
  });
});
