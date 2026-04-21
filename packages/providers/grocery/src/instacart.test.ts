/**
 * Unit tests for the Instacart adapter stub.
 *
 * The real adapter is gated on operator-provisioned credentials; every
 * call throws `InstacartNotConfiguredError` until the wiring lands.
 */

import { describe, expect, it } from 'vitest';

import { InstacartNotConfiguredError, createInstacartProvider } from './instacart.js';

// Minimal NangoClient double.
const nango = {} as Parameters<typeof createInstacartProvider>[0]['nango'];

describe('createInstacartProvider', () => {
  const provider = createInstacartProvider({
    nango,
    resolveStoreId: async () => undefined,
  });

  it('listRecentOrders throws InstacartNotConfiguredError', async () => {
    await expect(provider.listRecentOrders({ connectionId: 'c' })).rejects.toBeInstanceOf(
      InstacartNotConfiguredError,
    );
  });

  it('getOrder throws InstacartNotConfiguredError', async () => {
    await expect(provider.getOrder({ connectionId: 'c', orderId: 'o' })).rejects.toBeInstanceOf(
      InstacartNotConfiguredError,
    );
  });

  it('createDraftOrder throws InstacartNotConfiguredError', async () => {
    await expect(
      provider.createDraftOrder({ connectionId: 'c', items: [] }),
    ).rejects.toBeInstanceOf(InstacartNotConfiguredError);
  });
});
