/**
 * Unit tests for `generateGroceryOrderSuggestions`.
 */

import { describe, expect, it, vi } from 'vitest';

import { generateGroceryOrderSuggestions } from './grocery-order.js';

describe('generateGroceryOrderSuggestions', () => {
  it('emits no suggestions when deficits are empty', async () => {
    const out = await generateGroceryOrderSuggestions({
      householdId: 'h-1',
      plannedFor: '2026-04-25',
      deficits: [],
    });
    expect(out).toEqual([]);
  });

  it('emits a propose_grocery_order suggestion with deficit items', async () => {
    const out = await generateGroceryOrderSuggestions({
      householdId: 'h-1',
      plannedFor: '2026-04-25',
      deficits: [
        { name: 'Flour', quantity: 1, unit: 'kg', sourceMealIds: ['m-1'] },
        { name: 'Yeast', quantity: 1, unit: 'packet', sourceMealIds: ['m-1'] },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('propose_grocery_order');
    expect(out[0]!.preview.planned_for).toBe('2026-04-25');
    expect(out[0]!.dedupeKey).toBe('grocery_order:2026-04-25');
  });

  it('uses the rationale writer when supplied', async () => {
    const writer = vi.fn().mockResolvedValue('Shopping day is Saturday.');
    const out = await generateGroceryOrderSuggestions({
      householdId: 'h-1',
      plannedFor: '2026-04-25',
      deficits: [{ name: 'Milk', quantity: 1, unit: 'gal', sourceMealIds: [] }],
      rationaleWriter: writer,
    });
    expect(writer).toHaveBeenCalledTimes(1);
    expect(out[0]!.rationale).toBe('Shopping day is Saturday.');
  });
});
