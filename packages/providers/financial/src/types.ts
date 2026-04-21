/**
 * Canonical financial shapes HomeHub stores in `app.account` /
 * `app.transaction` / `app.budget`.
 *
 * Provider-agnostic on purpose: YNAB today, Monarch / Plaid / Copilot
 * post-M5-A. Each provider adapter maps upstream shapes to these types
 * at its boundary so the sync worker stays simple.
 *
 * Amount convention across HomeHub:
 *   - Every monetary value is in **cents** of the carrying `currency`.
 *   - **Signed.** Negative = outflow (spending / liability increase);
 *     positive = inflow (income / asset increase). Providers that publish
 *     unsigned amounts + a debit/credit flag (Plaid) flip the sign at the
 *     adapter boundary.
 *   - YNAB publishes **milliunits** (1 unit = 1000 milliunits). The
 *     `YnabProvider` divides by 10 to produce cents (for USD + most
 *     2-decimal currencies). Multi-currency is out of scope for M5-A.
 */

/**
 * Household account the provider owns. Mirrors `app.account`:
 *   - `sourceId` → `app.account.external_id`
 *   - `kind`      → `app.account.kind` (enum match)
 *   - `balanceCents` → `app.account.balance_cents`
 *   - `metadata`  → preserved verbatim on `app.account.metadata` via a
 *     backing jsonb column (today `app.account` has no metadata column;
 *     the sync worker folds provider extras into jsonb-backed side
 *     tables when / if we need them).
 */
export interface FinancialAccount {
  /** Provider's stable account id. */
  sourceId: string;
  /** Provider's change-detection token (YNAB: `last_reconciled_at` etc.). */
  sourceVersion?: string;
  name: string;
  kind: 'checking' | 'savings' | 'credit' | 'investment' | 'loan' | 'cash';
  /** ISO 4217 (e.g. `USD`). */
  currency: string;
  /** Signed. Positive = asset, negative = liability. */
  balanceCents: number;
  metadata: Record<string, unknown>;
}

/**
 * Single transaction on an account. Mirrors `app.transaction`:
 *   - `sourceId` + `source` (set by the adapter layer) drive the
 *     idempotent upsert key on `(source, source_id)`.
 *   - `accountSourceId` is the provider's account id; the sync worker
 *     resolves it to the `app.account.id` FK.
 *   - `cleared` mirrors YNAB's `cleared`/`reconciled` flag. Uncleared
 *     rows can still be persisted — the distinction surfaces in the UI.
 */
export interface FinancialTransaction {
  sourceId: string;
  sourceVersion?: string;
  accountSourceId: string;
  /** ISO-8601 date (YYYY-MM-DD) or datetime. */
  occurredAt: string;
  /** Signed cents. Negative = outflow. */
  amountCents: number;
  /** ISO 4217. */
  currency: string;
  merchantRaw?: string;
  /** Provider-native category string (raw, not normalized). */
  category?: string;
  memo?: string;
  cleared: boolean;
  metadata: Record<string, unknown>;
}

/**
 * Category budget from the upstream app. Mirrors `app.budget`:
 *   - HomeHub does not let users *create* budgets (spec: propose, don't
 *     write). We mirror what's upstream and compute per-period progress
 *     on read.
 */
export interface FinancialBudget {
  sourceId: string;
  name: string;
  /** Provider's native category (e.g. 'Groceries'). */
  category: string;
  period: 'weekly' | 'monthly' | 'yearly';
  /** Absolute budget amount in cents. Signed positive. */
  amountCents: number;
  currency: string;
}

export interface ListAccountsArgs {
  connectionId: string;
}

export interface ListTransactionsArgs {
  connectionId: string;
  /**
   * Provider-native continuation token. YNAB: the `server_knowledge`
   * from the previous page. When absent, the adapter returns all
   * transactions in the supported window.
   */
  sinceCursor?: string;
  /** Soft page cap; adapters may return fewer on final pages. */
  limit?: number;
}

export interface ListTransactionsPage {
  transactions: FinancialTransaction[];
  /** Present on the final page; store and reuse next time. */
  nextCursor?: string;
}

export interface ListBudgetsArgs {
  connectionId: string;
}

/**
 * Every financial-provider adapter implements this. Workers depend on
 * the interface, not a concrete provider — so a future Monarch / Plaid
 * adapter drops in without touching sync-worker code.
 *
 * NOTE: Monarch + Plaid + Copilot are deferred to M5-B+. Only
 * `YnabProvider` ships in M5-A.
 */
export interface FinancialProvider {
  listAccounts(args: ListAccountsArgs): Promise<FinancialAccount[]>;
  listTransactions(args: ListTransactionsArgs): AsyncIterable<ListTransactionsPage>;
  listBudgets(args: ListBudgetsArgs): Promise<FinancialBudget[]>;
}
