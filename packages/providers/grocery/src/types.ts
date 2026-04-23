/**
 * Canonical grocery-provider shapes HomeHub stores in
 * `app.grocery_list` / `app.grocery_list_item`.
 *
 * Provider-agnostic on purpose. The Instacart Developer Platform
 * adapter creates shopper-facing Marketplace URLs; the stub provider
 * keeps local flows testable without a provider key. The shape mirrors
 * the financial provider pattern so future grocery adapters can drop in
 * without churning worker code.
 *
 * Monetary amounts:
 *   - `pricePerUnitCents` + `totalCents` use signed cents in the
 *     carrying `currency`. Positive = outflow cost (the member owes it).
 *     Refunds / cancellations should use negative values on the item +
 *     a `status = 'cancelled'`.
 */

/**
 * One line item on a grocery order / draft.
 */
export interface GroceryItem {
  /** Provider's stable SKU when available. */
  sku?: string;
  name: string;
  /** Count or measured quantity. */
  quantity: number;
  unit?: string;
  pricePerUnitCents?: number;
}

export interface GroceryOrder {
  /** Provider's stable order id. Drives the `(provider, external_order_id)` upsert key. */
  sourceId: string;
  /** Provider change-detection token (e.g. Instacart `updated_at`). */
  sourceVersion?: string;
  status: 'draft' | 'placed' | 'fulfilled' | 'cancelled';
  storeName?: string;
  /** ISO-8601. */
  placedAt?: string;
  /** ISO-8601 window. */
  deliveryWindow?: { start: string; end: string };
  items: GroceryItem[];
  /** Signed cents total (subtotal + fees). */
  totalCents?: number;
  /** ISO 4217. */
  currency: string;
  metadata: Record<string, unknown>;
}

export interface ListRecentOrdersArgs {
  /** Provider connection id or HomeHub household sentinel. */
  connectionId: string;
  sinceDays?: number;
}

export interface GetOrderArgs {
  connectionId: string;
  orderId: string;
}

export interface CreateDraftOrderArgs {
  connectionId: string;
  items: GroceryItem[];
  metadata?: Record<string, unknown>;
}

export interface CreateDraftOrderResult {
  /** Provider's draft-order id. */
  draftId: string;
  /**
   * URL the member can hit to finalize the draft on the provider's
   * domain (Instacart cart URL, etc). The stub returns a sentinel
   * value so callers can branch on it.
   */
  url: string;
}

/**
 * Every grocery-provider adapter implements this. Workers depend on the
 * interface, not the concrete adapter — so a future Instacart /
 * custom-store adapter drops in without touching sync-grocery code.
 *
 * NOTE: Instacart shopping links do not expose order-history reads, so
 * its adapter returns no recent orders and rejects `getOrder`.
 */
export interface GroceryProvider {
  listRecentOrders(args: ListRecentOrdersArgs): Promise<GroceryOrder[]>;
  getOrder(args: GetOrderArgs): Promise<GroceryOrder>;
  createDraftOrder(args: CreateDraftOrderArgs): Promise<CreateDraftOrderResult>;
}
