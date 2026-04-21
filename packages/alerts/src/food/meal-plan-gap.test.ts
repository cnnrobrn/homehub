/**
 * Unit tests for `detectMealPlanGap`.
 */

import { describe, expect, it } from 'vitest';

import { MEAL_PLAN_HORIZON_DAYS, detectMealPlanGap } from './meal-plan-gap.js';
import { type MealRow, type PantryItemRow } from './types.js';

const HOUSEHOLD = 'h-1';

function pantry(id = 'p-1'): PantryItemRow {
  return {
    id,
    household_id: HOUSEHOLD,
    name: 'Rice',
    quantity: 1,
    unit: 'kg',
    expires_on: null,
    location: 'pantry',
    last_seen_at: null,
  };
}

function meal(overrides: Partial<MealRow>): MealRow {
  return {
    id: 'm-1',
    household_id: HOUSEHOLD,
    planned_for: '2026-04-20',
    slot: 'dinner',
    title: 'Pasta',
    dish_node_id: null,
    status: 'planned',
    servings: 4,
    cook_member_id: null,
    ...overrides,
  };
}

describe('detectMealPlanGap', () => {
  const now = new Date('2026-04-20T12:00:00Z');

  it('emits one alert per day with no dinner planned', () => {
    const out = detectMealPlanGap({
      householdId: HOUSEHOLD,
      meals: [],
      pantryItems: [pantry()],
      now,
    });
    expect(out).toHaveLength(MEAL_PLAN_HORIZON_DAYS);
    for (const alert of out) {
      expect(alert.kind).toBe('meal_plan_gap');
      expect(alert.severity).toBe('info');
      expect(alert.context.slot).toBe('dinner');
    }
  });

  it('suppresses days with a dinner already planned', () => {
    const out = detectMealPlanGap({
      householdId: HOUSEHOLD,
      meals: [meal({ planned_for: '2026-04-21', slot: 'dinner' })],
      pantryItems: [pantry()],
      now,
    });
    const dates = out.map((a) => a.context.date);
    expect(dates).not.toContain('2026-04-21');
    expect(out.length).toBe(MEAL_PLAN_HORIZON_DAYS - 1);
  });

  it('returns empty when pantry is empty', () => {
    const out = detectMealPlanGap({
      householdId: HOUSEHOLD,
      meals: [],
      pantryItems: [],
      now,
    });
    expect(out).toEqual([]);
  });

  it('ignores non-dinner slots', () => {
    const out = detectMealPlanGap({
      householdId: HOUSEHOLD,
      meals: [meal({ planned_for: '2026-04-21', slot: 'lunch' })],
      pantryItems: [pantry()],
      now,
    });
    const dates = out.map((a) => a.context.date);
    expect(dates).toContain('2026-04-21');
  });

  it('respects household scoping', () => {
    const out = detectMealPlanGap({
      householdId: HOUSEHOLD,
      meals: [],
      pantryItems: [pantry(), { ...pantry('p-2'), household_id: 'other' }],
      now,
    });
    // Only the HOUSEHOLD pantry item counts toward the threshold.
    expect(out[0]?.context.pantry_item_count).toBe(1);
  });

  it('dedupe keys are per-date', () => {
    const out = detectMealPlanGap({
      householdId: HOUSEHOLD,
      meals: [],
      pantryItems: [pantry()],
      now,
    });
    const keys = new Set(out.map((a) => a.dedupeKey));
    expect(keys.size).toBe(out.length);
  });
});
