/**
 * Instacart Developer Platform adapter.
 *
 * App-developer integrations authenticate with an application API key
 * and create Marketplace shopping-list URLs. The user logs into
 * Instacart on that URL, reviews matched products, and checks out on
 * Instacart. This is intentionally not a HomeHub-hosted checkout.
 */

import { GrocerySyncError } from './errors.js';
import {
  type CreateDraftOrderArgs,
  type CreateDraftOrderResult,
  type GetOrderArgs,
  type GroceryOrder,
  type GroceryProvider,
  type ListRecentOrdersArgs,
} from './types.js';

/** Provider key stamped on HomeHub grocery lists and sync rows. */
export const INSTACART_PROVIDER_KEY = 'instacart';

export const INSTACART_SOURCE = 'instacart' as const;
export const INSTACART_DEFAULT_BASE_URL = 'https://connect.instacart.com';

export class InstacartNotConfiguredError extends GrocerySyncError {
  constructor() {
    super(
      'instacart developer API key is not configured; set INSTACART_DEVELOPER_API_KEY before creating Instacart shopping links',
    );
  }
}

interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

type FetchLike = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
  },
) => Promise<FetchResponseLike>;

export interface CreateInstacartProviderArgs {
  apiKey?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  log?: {
    debug?: (msg: string, ctx?: Record<string, unknown>) => void;
  };
}

const UNIT_ALIASES: Record<string, string> = {
  count: 'each',
  ea: 'each',
  each: 'each',
  package: 'package',
  packages: 'package',
  pkg: 'package',
  tablespoon: 'tablespoon',
  tablespoons: 'tablespoon',
  tbsp: 'tablespoon',
  teaspoon: 'teaspoon',
  teaspoons: 'teaspoon',
  tsp: 'teaspoon',
  ounce: 'ounce',
  ounces: 'ounce',
  oz: 'ounce',
  pound: 'pound',
  pounds: 'pound',
  lb: 'pound',
  lbs: 'pound',
  gram: 'gram',
  grams: 'gram',
  g: 'gram',
  kilogram: 'kilogram',
  kilograms: 'kilogram',
  kg: 'kilogram',
  milliliter: 'milliliter',
  milliliters: 'milliliter',
  ml: 'milliliter',
  liter: 'liter',
  liters: 'liter',
  l: 'liter',
  cup: 'cup',
  cups: 'cup',
  can: 'each',
  cans: 'each',
  jar: 'each',
  jars: 'each',
  bunch: 'each',
  bunches: 'each',
};

function normalizeUnit(unit: string | undefined): string {
  if (!unit) return 'each';
  return UNIT_ALIASES[unit.trim().toLowerCase()] ?? 'each';
}

function lineItemsFor(args: CreateDraftOrderArgs): Array<Record<string, unknown>> {
  return args.items.map((item) => {
    const productId = item.sku ? Number(item.sku) : null;
    return {
      name: item.name,
      display_text: item.unit
        ? `${item.quantity} ${item.unit} ${item.name}`
        : `${item.quantity} ${item.name}`,
      line_item_measurements: [
        {
          quantity: item.quantity,
          unit: normalizeUnit(item.unit),
        },
      ],
      ...(productId !== null && Number.isFinite(productId) ? { product_ids: [productId] } : {}),
    };
  });
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function metadataNumber(metadata: Record<string, unknown> | undefined, key: string): number | null {
  const value = metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function createInstacartProvider(args: CreateInstacartProviderArgs): GroceryProvider {
  const baseUrl = (args.baseUrl ?? INSTACART_DEFAULT_BASE_URL).replace(/\/$/, '');
  const fetchImpl = args.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);

  return {
    async listRecentOrders(_opts: ListRecentOrdersArgs): Promise<GroceryOrder[]> {
      return [];
    },
    async getOrder(_opts: GetOrderArgs): Promise<GroceryOrder> {
      throw new GrocerySyncError(
        'instacart developer platform shopping links do not expose HomeHub-readable order details',
      );
    },
    async createDraftOrder(opts: CreateDraftOrderArgs): Promise<CreateDraftOrderResult> {
      if (!args.apiKey) throw new InstacartNotConfiguredError();
      if (!fetchImpl) {
        throw new GrocerySyncError('fetch is not available for instacart provider');
      }

      const payload = {
        title: metadataString(opts.metadata, 'title') ?? 'HomeHub grocery list',
        link_type: 'shopping_list',
        expires_in: metadataNumber(opts.metadata, 'expires_in') ?? 30,
        line_items: lineItemsFor(opts),
        landing_page_configuration: {
          partner_linkback_url: metadataString(opts.metadata, 'partner_linkback_url') ?? undefined,
        },
      };

      const res = await fetchImpl(`${baseUrl}/idp/v1/products/products_link`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${args.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new GrocerySyncError(
          `instacart products_link failed with ${res.status}${body ? `: ${body}` : ''}`,
        );
      }

      const json = await res.json();
      const url =
        json && typeof json === 'object' && 'products_link_url' in json
          ? (json as { products_link_url?: unknown }).products_link_url
          : null;
      if (typeof url !== 'string' || url.length === 0) {
        throw new GrocerySyncError('instacart products_link response missing products_link_url');
      }

      return {
        draftId: url,
        url,
      };
    },
  };
}
