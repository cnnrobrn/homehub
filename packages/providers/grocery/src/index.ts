/**
 * `@homehub/providers-grocery` — public surface.
 *
 * Keep this barrel tight. Consumers:
 *   - `apps/workers/sync-grocery` imports the stub provider (the
 *     Instacart adapter is wired but gated behind
 *     `HOMEHUB_GROCERY_INGESTION_ENABLED` and
 *     `InstacartNotConfiguredError`).
 *   - `apps/workers/pantry-diff` doesn't call providers directly — it
 *     only writes `app.grocery_list` drafts from pantry deficits.
 *
 * Future adapters (Instacart live, Amazon Fresh, local stores) export
 * alongside the stub here.
 */

export { GroceryNotFoundError, GroceryRateLimitError, GrocerySyncError } from './errors.js';

export {
  type CreateDraftOrderArgs,
  type CreateDraftOrderResult,
  type GetOrderArgs,
  type GroceryItem,
  type GroceryOrder,
  type GroceryProvider,
  type ListRecentOrdersArgs,
} from './types.js';

export { STUB_DRAFT_URL, STUB_PROVIDER_KEY, createStubGroceryProvider } from './stub.js';

export {
  INSTACART_PROVIDER_KEY,
  INSTACART_SOURCE,
  InstacartNotConfiguredError,
  createInstacartProvider,
  type CreateInstacartProviderArgs,
} from './instacart.js';
