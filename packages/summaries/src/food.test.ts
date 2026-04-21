/**
 * Unit tests for `renderFoodSummary`.
 */

import { describe, expect, it } from 'vitest';

import { computeFoodMetrics, renderFoodSummary } from './food.js';
import { type FoodSummaryInput, type MealSummaryRow, type PantryItemSummaryRow } from './types.js';

import type { HouseholdId } from '@homehub/shared';

const HOUSEHOLD = 'h-1' as HouseholdId;

function makeInput(overrides: Partial<FoodSummaryInput> = {}): FoodSummaryInput {
  return {
    householdId: HOUSEHOLD,
    period: 'weekly',
    coveredStart: '2026-04-13T00:00:00.000Z',
    coveredEnd: '2026-04-20T00:00:00.000Z',
    meals: [],
    pantryItems: [],
    memberNamesById: new Map([['mem-a', 'Alex']]),
    ...overrides,
  };
}

function meal(
  overrides: Partial<MealSummaryRow> & Pick<MealSummaryRow, 'id' | 'planned_for'>,
): MealSummaryRow {
  return {
    household_id: HOUSEHOLD as string,
    slot: 'dinner',
    title: 'Tacos',
    dish_node_id: null,
    cook_member_id: 'mem-a',
    status: 'planned',
    ...overrides,
  };
}

function pantry(
  overrides: Partial<PantryItemSummaryRow> & Pick<PantryItemSummaryRow, 'id'>,
): PantryItemSummaryRow {
  return {
    household_id: HOUSEHOLD as string,
    name: 'Spinach',
    expires_on: null,
    ...overrides,
  };
}

describe('computeFoodMetrics', () => {
  it('returns zeros when there is no activity', () => {
    const metrics = computeFoodMetrics(makeInput());
    expect(metrics.mealCount).toBe(0);
    expect(metrics.dishVariety).toBe(0);
    expect(metrics.dishVarietyRatio).toBe(0);
  });

  it('counts meals, dish variety, and pantry expiry in-window', () => {
    const metrics = computeFoodMetrics(
      makeInput({
        meals: [
          meal({ id: 'm-1', planned_for: '2026-04-14', title: 'Tacos' }),
          meal({ id: 'm-2', planned_for: '2026-04-15', title: 'Pasta' }),
          meal({ id: 'm-3', planned_for: '2026-04-16', title: 'Tacos' }),
        ],
        pantryItems: [
          pantry({ id: 'p-1', expires_on: '2026-04-14' }),
          pantry({ id: 'p-2', expires_on: '2026-04-25' }),
        ],
      }),
    );
    expect(metrics.mealCount).toBe(3);
    expect(metrics.dishVariety).toBe(2);
    expect(metrics.pantryItemsExpired).toBe(1);
    expect(metrics.cookingByMember).toEqual([
      { memberId: 'mem-a', memberName: 'Alex', mealCount: 3 },
    ]);
  });

  it('ignores meals outside the window', () => {
    const metrics = computeFoodMetrics(
      makeInput({
        meals: [
          meal({ id: 'm-1', planned_for: '2025-12-01', title: 'Leftover' }),
          meal({ id: 'm-2', planned_for: '2026-04-14', title: 'Tacos' }),
        ],
      }),
    );
    expect(metrics.mealCount).toBe(1);
  });
});

describe('renderFoodSummary', () => {
  it('renders the no-activity fallback', () => {
    const out = renderFoodSummary(makeInput());
    expect(out.bodyMd).toMatch(/No meals planned/i);
  });

  it('renders meals + variety + cooking distribution', () => {
    const out = renderFoodSummary(
      makeInput({
        meals: [
          meal({ id: 'm-1', planned_for: '2026-04-14' }),
          meal({ id: 'm-2', planned_for: '2026-04-15' }),
        ],
      }),
    );
    expect(out.bodyMd).toMatch(/Weekly food brief/i);
    expect(out.bodyMd).toMatch(/Alex: 2 meals/i);
    expect(out.metrics.mealCount).toBe(2);
  });
});
