/**
 * `@homehub/providers-financial` — public surface.
 *
 * Keep this barrel tight. Consumers:
 *   - `apps/workers/sync-financial` imports `createYnabProvider` + the
 *     error classes + `YNAB_SOURCE`.
 *   - `apps/workers/webhook-ingest` imports `YNAB_PROVIDER_KEY` to
 *     route the `connection.created` webhook.
 *   - `apps/workers/reconciler` imports the `FinancialProvider` types
 *     if / when it ever needs them (today it works off DB rows).
 *
 * Future adapters (Monarch, Plaid, Copilot) export alongside YNAB here.
 */

export { CursorExpiredError, FinancialSyncError, RateLimitError } from './errors.js';

export {
  type FinancialAccount,
  type FinancialBudget,
  type FinancialProvider,
  type FinancialTransaction,
  type ListAccountsArgs,
  type ListBudgetsArgs,
  type ListTransactionsArgs,
  type ListTransactionsPage,
} from './types.js';

export {
  YNAB_PROVIDER_KEY,
  YNAB_SOURCE,
  createYnabProvider,
  mapAccountKind,
  milliunitsToCents,
  type CreateYnabProviderArgs,
} from './ynab.js';
