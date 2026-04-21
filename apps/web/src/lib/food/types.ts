/**
 * Shared types used across the food server helpers + server actions.
 */

export interface SegmentGrant {
  segment: string;
  access: 'none' | 'read' | 'write';
}

export function hasFoodRead(grants: readonly SegmentGrant[]): boolean {
  return grants.some((g) => g.segment === 'food' && (g.access === 'read' || g.access === 'write'));
}

export function hasFoodWrite(grants: readonly SegmentGrant[]): boolean {
  return grants.some((g) => g.segment === 'food' && g.access === 'write');
}

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export const MEAL_STATUSES = ['planned', 'cooking', 'served', 'skipped'] as const;
export type MealStatus = (typeof MEAL_STATUSES)[number];

export const PANTRY_LOCATIONS = ['fridge', 'freezer', 'pantry'] as const;
export type PantryLocation = (typeof PANTRY_LOCATIONS)[number];

export const GROCERY_STATUSES = ['draft', 'ordered', 'received', 'cancelled'] as const;
export type GroceryStatus = (typeof GROCERY_STATUSES)[number];
