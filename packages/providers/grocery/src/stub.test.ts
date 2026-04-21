/**
 * Unit tests for the stub grocery provider.
 */

import { describe, expect, it } from 'vitest';

import { GroceryNotFoundError } from './errors.js';
import { STUB_DRAFT_URL, createStubGroceryProvider } from './stub.js';

describe('createStubGroceryProvider', () => {
  it('listRecentOrders returns an empty array', async () => {
    const provider = createStubGroceryProvider();
    const out = await provider.listRecentOrders({ connectionId: 'conn-1' });
    expect(out).toEqual([]);
  });

  it('getOrder throws GroceryNotFoundError', async () => {
    const provider = createStubGroceryProvider();
    await expect(
      provider.getOrder({ connectionId: 'conn-1', orderId: 'o-1' }),
    ).rejects.toBeInstanceOf(GroceryNotFoundError);
  });

  it('createDraftOrder returns a sentinel URL', async () => {
    const provider = createStubGroceryProvider();
    const out = await provider.createDraftOrder({
      connectionId: 'conn-1',
      items: [{ name: 'Milk', quantity: 1 }],
    });
    expect(out.url).toBe(STUB_DRAFT_URL);
    expect(out.draftId).toMatch(/^stub-/);
  });
});
