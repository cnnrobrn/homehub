/**
 * Instacart grocery-provider adapter.
 *
 * Real Instacart Partner API access is human-gated (signed agreement +
 * operator-provisioned credentials in Nango). Until that lands in
 * production, every caller gets the stub adapter — this file documents
 * the shape the real adapter will take so the interface is frozen.
 *
 * Construction:
 *   - `createInstacartProvider({ nango, resolveStoreId })` returns a
 *     `GroceryProvider`. Today it throws `InstacartNotConfiguredError`
 *     on every call; the worker + UI fall back to the stub adapter.
 *
 * When real credentials ship, the body swaps to Nango proxy calls
 * (`/v1/orders`, `/v1/draft_orders`) and the stub-fallback path in
 * `sync-grocery` is retired.
 */

import { type NangoClient } from '@homehub/worker-runtime';

import { GrocerySyncError } from './errors.js';
import {
  type CreateDraftOrderArgs,
  type CreateDraftOrderResult,
  type GetOrderArgs,
  type GroceryOrder,
  type GroceryProvider,
  type ListRecentOrdersArgs,
} from './types.js';

/** Nango provider-config key for Instacart. */
export const INSTACART_PROVIDER_KEY = 'instacart';

export const INSTACART_SOURCE = 'instacart' as const;

export class InstacartNotConfiguredError extends GrocerySyncError {
  constructor() {
    super(
      'instacart provider is not yet configured; operators must provision Nango credentials and ' +
        'flip HOMEHUB_GROCERY_INGESTION_ENABLED to true before live traffic',
    );
  }
}

export interface CreateInstacartProviderArgs {
  nango: NangoClient;
  /**
   * Resolver for the member-selected Instacart store id. The sync
   * worker wires this to a
   * `sync.provider_connection.metadata.instacart_store_id` lookup.
   */
  resolveStoreId: (connectionId: string) => Promise<string | undefined>;
  log?: {
    debug?: (msg: string, ctx?: Record<string, unknown>) => void;
  };
}

/**
 * Real adapter. Always throws `InstacartNotConfiguredError` until
 * operator credentials land. The signature is stable so the worker
 * wiring doesn't churn when the body fills in.
 */
export function createInstacartProvider(args: CreateInstacartProviderArgs): GroceryProvider {
  void args;
  return {
    async listRecentOrders(_opts: ListRecentOrdersArgs): Promise<GroceryOrder[]> {
      throw new InstacartNotConfiguredError();
    },
    async getOrder(_opts: GetOrderArgs): Promise<GroceryOrder> {
      throw new InstacartNotConfiguredError();
    },
    async createDraftOrder(_opts: CreateDraftOrderArgs): Promise<CreateDraftOrderResult> {
      throw new InstacartNotConfiguredError();
    },
  };
}
