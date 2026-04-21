/**
 * Stub grocery provider.
 *
 * Instacart API access is human-gated (operator signs a partner-API
 * agreement + picks up credentials). Until that lands, every worker
 * that expects a concrete `GroceryProvider` is handed this stub: it
 * returns empty order lists and a sentinel draft URL so the pipeline
 * exercises the interface end-to-end without calling an external API.
 *
 * The stub is also useful as an "export-only" provider for households
 * that want to draft a grocery list inside HomeHub and then take it
 * elsewhere (e.g. a printed list). `createDraftOrder` returns a
 * sentinel URL the web UI branches on to render a copy-to-clipboard
 * export instead of a deep link.
 */

import { GroceryNotFoundError } from './errors.js';
import {
  type CreateDraftOrderArgs,
  type CreateDraftOrderResult,
  type GetOrderArgs,
  type GroceryOrder,
  type GroceryProvider,
  type ListRecentOrdersArgs,
} from './types.js';

/** Sentinel URL value returned by the stub. UI + workers branch on this. */
export const STUB_DRAFT_URL = 'homehub://grocery-draft/stub';

/** Fixed provider key stamped on `app.grocery_list.provider`. */
export const STUB_PROVIDER_KEY = 'stub' as const;

export function createStubGroceryProvider(): GroceryProvider {
  return {
    async listRecentOrders(_args: ListRecentOrdersArgs): Promise<GroceryOrder[]> {
      return [];
    },
    async getOrder(args: GetOrderArgs): Promise<GroceryOrder> {
      throw new GroceryNotFoundError(`stub grocery provider has no order ${args.orderId}`);
    },
    async createDraftOrder(_args: CreateDraftOrderArgs): Promise<CreateDraftOrderResult> {
      // Deterministic draft id so callers can dedupe retries.
      const stamp = Date.now().toString(36);
      return {
        draftId: `stub-${stamp}`,
        url: STUB_DRAFT_URL,
      };
    },
  };
}
