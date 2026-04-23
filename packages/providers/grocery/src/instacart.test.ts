/**
 * Unit tests for the Instacart Developer Platform adapter.
 */

import { describe, expect, it, vi } from 'vitest';

import { GrocerySyncError } from './errors.js';
import {
  InstacartNotConfiguredError,
  createInstacartProvider,
  type CreateInstacartProviderArgs,
} from './instacart.js';

type FetchInit = Parameters<NonNullable<CreateInstacartProviderArgs['fetch']>>[1];

describe('createInstacartProvider', () => {
  it('listRecentOrders returns empty because shopping links do not expose order history', async () => {
    const provider = createInstacartProvider({});

    await expect(provider.listRecentOrders({ connectionId: 'c' })).resolves.toEqual([]);
  });

  it('getOrder rejects because shopping links do not expose readable order details', async () => {
    const provider = createInstacartProvider({});

    await expect(provider.getOrder({ connectionId: 'c', orderId: 'o' })).rejects.toBeInstanceOf(
      GrocerySyncError,
    );
  });

  it('createDraftOrder requires an Instacart Developer Platform API key', async () => {
    const provider = createInstacartProvider({});

    await expect(
      provider.createDraftOrder({ connectionId: 'c', items: [{ name: 'Milk', quantity: 1 }] }),
    ).rejects.toBeInstanceOf(InstacartNotConfiguredError);
  });

  it('creates a shopping-list link with normalized measurements', async () => {
    const fetch = vi.fn(async (_url: string, _init: FetchInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ products_link_url: 'https://www.instacart.com/store/list-123' }),
      text: async () => '',
    }));
    const provider = createInstacartProvider({
      apiKey: 'ic-key',
      baseUrl: 'https://connect.dev.instacart.tools/',
      fetch,
    });

    const result = await provider.createDraftOrder({
      connectionId: 'household:h1',
      items: [
        { name: 'Milk', quantity: 1, unit: 'carton' },
        { name: 'Flour', quantity: 2, unit: 'cups', sku: '12345' },
      ],
      metadata: {
        title: 'HomeHub groceries',
        expires_in: 7,
        partner_linkback_url: 'https://homehub.test/food/groceries',
      },
    });

    expect(result).toEqual({
      draftId: 'https://www.instacart.com/store/list-123',
      url: 'https://www.instacart.com/store/list-123',
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://connect.dev.instacart.tools/idp/v1/products/products_link',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ic-key',
          'Content-Type': 'application/json',
        },
        body: expect.any(String),
      },
    );
    const firstCall = fetch.mock.calls[0];
    expect(firstCall).toBeDefined();
    const body = JSON.parse(firstCall![1].body) as {
      title: string;
      link_type: string;
      expires_in: number;
      line_items: Array<{
        name: string;
        display_text: string;
        product_ids?: number[];
        line_item_measurements: Array<{ quantity: number; unit: string }>;
      }>;
      landing_page_configuration: { partner_linkback_url: string };
    };
    expect(body.title).toBe('HomeHub groceries');
    expect(body.link_type).toBe('shopping_list');
    expect(body.expires_in).toBe(7);
    expect(body.landing_page_configuration.partner_linkback_url).toBe(
      'https://homehub.test/food/groceries',
    );
    expect(body.line_items).toEqual([
      {
        name: 'Milk',
        display_text: '1 carton Milk',
        line_item_measurements: [{ quantity: 1, unit: 'each' }],
      },
      {
        name: 'Flour',
        display_text: '2 cups Flour',
        product_ids: [12345],
        line_item_measurements: [{ quantity: 2, unit: 'cup' }],
      },
    ]);
  });

  it('surfaces provider error bodies', async () => {
    const provider = createInstacartProvider({
      apiKey: 'ic-key',
      fetch: async () => ({
        ok: false,
        status: 400,
        json: async () => ({}),
        text: async () => 'bad unit',
      }),
    });

    await expect(
      provider.createDraftOrder({ connectionId: 'c', items: [{ name: 'Milk', quantity: 1 }] }),
    ).rejects.toThrow('instacart products_link failed with 400: bad unit');
  });
});
