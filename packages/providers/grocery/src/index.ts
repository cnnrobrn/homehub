/**
 * `@homehub/providers-grocery` — public surface.
 *
 * Keep this barrel tight. Consumers:
 *   - `apps/web` and `apps/workers/action-executor` create Instacart
 *     shopping-list links when `INSTACART_DEVELOPER_API_KEY` is set.
 *   - `apps/workers/sync-grocery` still imports the interface, but
 *     Instacart shopping links do not expose order-history reads.
 *   - `apps/workers/pantry-diff` doesn't call providers directly — it
 *     only writes `app.grocery_list` drafts from pantry deficits.
 *
 * Future adapters (Amazon Fresh, local stores) export alongside the
 * stub here.
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
