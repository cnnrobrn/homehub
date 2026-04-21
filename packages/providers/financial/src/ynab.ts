/**
 * YNAB financial-provider adapter.
 *
 * Speaks the YNAB v1 REST API through Nango's proxy (zero raw tokens;
 * Nango owns OAuth refresh per `specs/03-integrations/nango.md`).
 *
 * Design notes:
 *   - YNAB models everything inside a "budget". A YNAB user typically
 *     has one budget but may have several (legacy / archived). We pick
 *     the budget at connect time and store the selection in
 *     `sync.provider_connection.metadata.ynab_budget_id`. If the
 *     metadata is missing, we fall back to the first non-tombstoned
 *     budget returned by `/budgets`. A UI-driven budget-picker is a
 *     follow-up for @frontend-chat (see M5-C).
 *
 *   - Amount normalization: YNAB amounts are **milliunits** (1 unit =
 *     1000 milliunits). Cents = milliunits / 10 for 2-decimal currencies.
 *     YNAB is USD-first; multi-currency is out of M5-A scope.
 *
 *   - Delta sync uses YNAB's `last_knowledge_of_server` cursor. Pass it
 *     on the URL as `?last_knowledge_of_server=<int>`; the server's reply
 *     carries a new `server_knowledge` we store as the next cursor.
 *
 *   - Errors: YNAB surfaces:
 *       - 429 → `RateLimitError` (default 300s retry).
 *       - 409 with `id = 'knowledge_out_of_date'` → `CursorExpiredError`
 *         so the worker drops the cursor and requeues full.
 *       - Anything else → `FinancialSyncError` (terminal).
 *
 *   - Account kind mapping: YNAB uses a small enum. Anything unknown
 *     defaults to `checking` on the HomeHub side (the member can edit
 *     later). Per YNAB docs: `checking`, `savings`, `cash`, `creditCard`,
 *     `lineOfCredit`, `otherAsset`, `otherLiability`, `autoLoan`,
 *     `mortgage`, `studentLoan`, `medicalDebt`, `personalLoan`.
 */

import { type NangoClient, NangoError } from '@homehub/worker-runtime';

import { CursorExpiredError, FinancialSyncError, RateLimitError } from './errors.js';
import {
  type FinancialAccount,
  type FinancialBudget,
  type FinancialProvider,
  type FinancialTransaction,
  type ListAccountsArgs,
  type ListBudgetsArgs,
  type ListTransactionsArgs,
  type ListTransactionsPage,
} from './types.js';

/** Nango provider-config key for YNAB. Fixed by convention. */
export const YNAB_PROVIDER_KEY = 'ynab';

/** HomeHub-side provider label persisted to `app.transaction.source`. */
export const YNAB_SOURCE = 'ynab' as const;

/** Fallback retry when YNAB 429s without a Retry-After header. */
const DEFAULT_RATE_LIMIT_RETRY_SECONDS = 300;

/**
 * Default page cap. YNAB does not paginate /transactions — the whole
 * delta comes back in one call. We keep a soft cap to bound memory in
 * pathological cases (e.g. restoring a multi-decade budget on first sync).
 */
const DEFAULT_PAGE_LIMIT = 2_000;

/**
 * How far back to request transactions when no `sinceCursor` is
 * supplied. YNAB accepts `?since_date=YYYY-MM-DD`; the spec says 12
 * months on initial backfill.
 */
const FULL_SYNC_PAST_DAYS = 365;

// --- Narrow YNAB API response shapes. We only pull fields we use; the
//   raw response is preserved on `metadata`.

interface RawBudget {
  id?: string;
  name?: string;
  last_modified_on?: string;
  first_month?: string;
  last_month?: string;
  currency_format?: { iso_code?: string; decimal_digits?: number } | null;
  [key: string]: unknown;
}

interface RawAccount {
  id?: string;
  name?: string;
  /** YNAB's enum: checking / savings / cash / creditCard / lineOfCredit / otherAsset / otherLiability / autoLoan / mortgage / studentLoan / medicalDebt / personalLoan. */
  type?: string;
  on_budget?: boolean;
  closed?: boolean;
  note?: string | null;
  balance?: number; // milliunits
  cleared_balance?: number; // milliunits
  uncleared_balance?: number; // milliunits
  transfer_payee_id?: string | null;
  direct_import_linked?: boolean;
  direct_import_in_error?: boolean;
  last_reconciled_at?: string | null;
  deleted?: boolean;
  [key: string]: unknown;
}

interface RawTransaction {
  id?: string;
  date?: string; // YYYY-MM-DD
  amount?: number; // milliunits, signed
  memo?: string | null;
  cleared?: string; // 'cleared' | 'uncleared' | 'reconciled'
  approved?: boolean;
  flag_color?: string | null;
  account_id?: string;
  account_name?: string;
  payee_id?: string | null;
  payee_name?: string | null;
  category_id?: string | null;
  category_name?: string | null;
  transfer_account_id?: string | null;
  transfer_transaction_id?: string | null;
  matched_transaction_id?: string | null;
  import_id?: string | null;
  import_payee_name?: string | null;
  import_payee_name_original?: string | null;
  debt_transaction_type?: string | null;
  deleted?: boolean;
  [key: string]: unknown;
}

interface RawCategory {
  id?: string;
  category_group_id?: string;
  name?: string;
  hidden?: boolean;
  original_category_group_id?: string | null;
  note?: string | null;
  budgeted?: number; // milliunits for the current month
  activity?: number; // milliunits
  balance?: number; // milliunits
  goal_type?: string | null;
  goal_target?: number | null;
  deleted?: boolean;
  [key: string]: unknown;
}

interface RawCategoryGroup {
  id?: string;
  name?: string;
  hidden?: boolean;
  deleted?: boolean;
  categories?: RawCategory[];
  [key: string]: unknown;
}

interface BudgetsResponse {
  data?: {
    budgets?: RawBudget[];
    default_budget?: RawBudget | null;
  };
}

interface AccountsResponse {
  data?: {
    accounts?: RawAccount[];
    server_knowledge?: number;
  };
}

interface TransactionsResponse {
  data?: {
    transactions?: RawTransaction[];
    server_knowledge?: number;
  };
}

interface CategoriesResponse {
  data?: {
    category_groups?: RawCategoryGroup[];
    server_knowledge?: number;
  };
}

interface YnabErrorBody {
  error?: {
    id?: string;
    name?: string;
    detail?: string;
  };
}

/** Coerce Retry-After into seconds; falls back to the 5-minute default. */
function parseRetryAfter(value: string | undefined): number {
  if (!value) return DEFAULT_RATE_LIMIT_RETRY_SECONDS;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;
  const asDate = Date.parse(value);
  if (Number.isFinite(asDate)) {
    const diff = Math.ceil((asDate - Date.now()) / 1_000);
    if (diff > 0) return diff;
  }
  return DEFAULT_RATE_LIMIT_RETRY_SECONDS;
}

/**
 * Inspect an error from Nango's proxy and map provider-shape YNAB
 * responses to our typed errors. Preserves the cause chain for Sentry.
 */
function classifyNangoError(err: unknown): never {
  if (err instanceof NangoError) {
    const cause = err.cause as
      | {
          response?: {
            status?: number;
            statusText?: string;
            headers?: Record<string, string>;
            data?: YnabErrorBody;
          };
        }
      | undefined;
    const status = cause?.response?.status;
    const body = cause?.response?.data;
    const errorId = body?.error?.id ?? '';

    // 409 with knowledge_out_of_date → drop the cursor and requeue full.
    if (status === 409 && errorId === 'knowledge_out_of_date') {
      throw new CursorExpiredError('ynab server_knowledge expired; full resync required', {
        cause: err,
      });
    }
    // 429 → rate limit. YNAB has no Retry-After today; we default.
    if (status === 429) {
      const retryAfter = parseRetryAfter(cause?.response?.headers?.['retry-after']);
      throw new RateLimitError('ynab rate limit exceeded', retryAfter, { cause: err });
    }
  }
  throw new FinancialSyncError('ynab proxy call failed', { cause: err });
}

/**
 * Map YNAB's account `type` enum to HomeHub's canonical `kind` enum.
 * Unknown values fall through to `checking` and get flagged in
 * `metadata.unmapped_kind` so the sync worker can alert on drift.
 */
export function mapAccountKind(type: string | undefined): FinancialAccount['kind'] {
  switch (type) {
    case 'checking':
      return 'checking';
    case 'savings':
      return 'savings';
    case 'cash':
      return 'cash';
    case 'creditCard':
    case 'lineOfCredit':
      return 'credit';
    case 'autoLoan':
    case 'mortgage':
    case 'studentLoan':
    case 'medicalDebt':
    case 'personalLoan':
    case 'otherLiability':
      return 'loan';
    case 'otherAsset':
      return 'investment';
    default:
      return 'checking';
  }
}

/**
 * Convert YNAB milliunits → cents. YNAB USD: 1 unit = 1000 milliunits,
 * 1 unit = 100 cents, so `cents = milliunits / 10`. We use
 * `Math.round` to keep sub-cent rounding stable (YNAB's milliunit
 * values are always whole integers for 2-decimal currencies, but the
 * round is belt-and-suspenders for any future 3-decimal cases).
 */
export function milliunitsToCents(milliunits: number | undefined): number {
  if (!Number.isFinite(milliunits)) return 0;
  return Math.round((milliunits ?? 0) / 10);
}

function normalizeAccount(raw: RawAccount): FinancialAccount | null {
  if (!raw.id || raw.deleted) return null;
  const mapped = mapAccountKind(raw.type);
  const unmapped = mapped === 'checking' && raw.type !== 'checking';

  // Strip fields we already normalize; preserve the rest on metadata.
  const {
    id: _id,
    name: _name,
    type: _type,
    balance: _balance,
    closed: _closed,
    deleted: _deleted,
    last_reconciled_at: _lastRec,
    ...rest
  } = raw;

  return {
    sourceId: raw.id,
    ...(raw.last_reconciled_at ? { sourceVersion: raw.last_reconciled_at } : {}),
    name: raw.name ?? '(unnamed account)',
    kind: mapped,
    // YNAB is USD-first; adapter-level currency comes from the budget
    // context and is injected by the caller.
    currency: 'USD',
    balanceCents: milliunitsToCents(raw.balance),
    metadata: {
      ...rest,
      ynab_type: raw.type ?? null,
      closed: Boolean(raw.closed),
      ...(unmapped ? { unmapped_kind: raw.type } : {}),
    },
  };
}

function normalizeTransaction(raw: RawTransaction): FinancialTransaction | null {
  if (!raw.id || !raw.account_id || !raw.date || raw.deleted) return null;
  const cleared = raw.cleared === 'cleared' || raw.cleared === 'reconciled';

  const {
    id: _id,
    date: _date,
    amount: _amount,
    memo: _memo,
    cleared: _cleared,
    account_id: _accountId,
    payee_name: _payeeName,
    category_name: _categoryName,
    deleted: _deleted,
    ...rest
  } = raw;

  return {
    sourceId: raw.id,
    ...(raw.import_id ? { sourceVersion: raw.import_id } : {}),
    accountSourceId: raw.account_id,
    occurredAt: raw.date,
    amountCents: milliunitsToCents(raw.amount),
    currency: 'USD',
    ...(raw.payee_name ? { merchantRaw: raw.payee_name } : {}),
    ...(raw.category_name ? { category: raw.category_name } : {}),
    ...(raw.memo ? { memo: raw.memo } : {}),
    cleared,
    metadata: {
      ...rest,
      ynab_cleared: raw.cleared ?? null,
      ...(raw.transfer_account_id ? { transfer_account_id: raw.transfer_account_id } : {}),
    },
  };
}

function normalizeBudgetCategory(
  group: RawCategoryGroup,
  cat: RawCategory,
): FinancialBudget | null {
  if (!cat.id || !cat.name || cat.deleted || cat.hidden) return null;
  if (!group.name || group.hidden || group.deleted) return null;
  if (cat.budgeted == null) return null;
  // YNAB budgets are monthly. Amount is this-month's budgeted value.
  return {
    sourceId: cat.id,
    name: `${group.name} / ${cat.name}`,
    category: cat.name,
    period: 'monthly',
    amountCents: milliunitsToCents(cat.budgeted),
    currency: 'USD',
  };
}

export interface CreateYnabProviderArgs {
  nango: NangoClient;
  /**
   * Resolver for the member-selected YNAB budget id. The sync worker
   * wires this to a `sync.provider_connection.metadata.ynab_budget_id`
   * lookup; tests pass a fixed mapping.
   */
  resolveBudgetId: (connectionId: string) => Promise<string | undefined>;
  log?: {
    debug?: (msg: string, ctx?: Record<string, unknown>) => void;
  };
}

export function createYnabProvider(args: CreateYnabProviderArgs): FinancialProvider {
  const { nango, resolveBudgetId, log } = args;

  /**
   * Per-connection budget-id cache. `listAccounts` and the iterators
   * hit this on every call; the underlying `resolveBudgetId` goes to
   * the database and we want to minimize that.
   */
  const budgetIdCache = new Map<string, string>();

  async function getBudgetId(connectionId: string): Promise<string> {
    const cached = budgetIdCache.get(connectionId);
    if (cached) return cached;
    const stored = await resolveBudgetId(connectionId);
    if (stored) {
      budgetIdCache.set(connectionId, stored);
      return stored;
    }

    // No stored budget id — fall back to the first active budget.
    let response: BudgetsResponse;
    try {
      response = await nango.proxy<BudgetsResponse>({
        providerConfigKey: YNAB_PROVIDER_KEY,
        connectionId,
        method: 'GET',
        endpoint: '/v1/budgets',
      });
    } catch (err) {
      classifyNangoError(err);
    }

    const budgets = response.data?.budgets ?? [];
    const chosen = response.data?.default_budget ?? budgets[0];
    if (!chosen?.id) {
      throw new FinancialSyncError(
        `ynab returned no budgets for connection ${connectionId}; cannot select a budget id`,
      );
    }
    budgetIdCache.set(connectionId, chosen.id);
    return chosen.id;
  }

  async function listAccounts(opts: ListAccountsArgs): Promise<FinancialAccount[]> {
    const budgetId = await getBudgetId(opts.connectionId);
    let response: AccountsResponse;
    try {
      response = await nango.proxy<AccountsResponse>({
        providerConfigKey: YNAB_PROVIDER_KEY,
        connectionId: opts.connectionId,
        method: 'GET',
        endpoint: `/v1/budgets/${budgetId}/accounts`,
      });
    } catch (err) {
      classifyNangoError(err);
    }
    log?.debug?.('ynab accounts fetched', {
      connection_id: opts.connectionId,
      count: response.data?.accounts?.length ?? 0,
    });
    const accounts = response.data?.accounts ?? [];
    const out: FinancialAccount[] = [];
    for (const raw of accounts) {
      const normalized = normalizeAccount(raw);
      if (normalized) out.push(normalized);
    }
    return out;
  }

  async function* listTransactions(
    opts: ListTransactionsArgs,
  ): AsyncIterable<ListTransactionsPage> {
    const budgetId = await getBudgetId(opts.connectionId);
    const limit = opts.limit ?? DEFAULT_PAGE_LIMIT;
    const params: Record<string, string | number> = {};

    if (opts.sinceCursor) {
      params.last_knowledge_of_server = opts.sinceCursor;
    } else {
      const sinceDate = new Date(Date.now() - FULL_SYNC_PAST_DAYS * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      params.since_date = sinceDate;
    }

    let response: TransactionsResponse;
    try {
      response = await nango.proxy<TransactionsResponse>({
        providerConfigKey: YNAB_PROVIDER_KEY,
        connectionId: opts.connectionId,
        method: 'GET',
        endpoint: `/v1/budgets/${budgetId}/transactions`,
        params,
      });
    } catch (err) {
      classifyNangoError(err);
    }

    log?.debug?.('ynab transactions fetched', {
      connection_id: opts.connectionId,
      count: response.data?.transactions?.length ?? 0,
      has_cursor: Boolean(response.data?.server_knowledge),
    });

    const transactions: FinancialTransaction[] = [];
    for (const raw of response.data?.transactions ?? []) {
      const normalized = normalizeTransaction(raw);
      if (normalized) transactions.push(normalized);
      if (transactions.length >= limit) break;
    }

    const nextCursor = response.data?.server_knowledge;
    yield {
      transactions,
      ...(nextCursor != null ? { nextCursor: String(nextCursor) } : {}),
    };
  }

  async function listBudgets(opts: ListBudgetsArgs): Promise<FinancialBudget[]> {
    const budgetId = await getBudgetId(opts.connectionId);
    let response: CategoriesResponse;
    try {
      response = await nango.proxy<CategoriesResponse>({
        providerConfigKey: YNAB_PROVIDER_KEY,
        connectionId: opts.connectionId,
        method: 'GET',
        endpoint: `/v1/budgets/${budgetId}/categories`,
      });
    } catch (err) {
      classifyNangoError(err);
    }

    const groups = response.data?.category_groups ?? [];
    const out: FinancialBudget[] = [];
    for (const group of groups) {
      if (group.hidden || group.deleted) continue;
      for (const cat of group.categories ?? []) {
        const budget = normalizeBudgetCategory(group, cat);
        if (budget) out.push(budget);
      }
    }
    log?.debug?.('ynab budgets fetched', {
      connection_id: opts.connectionId,
      count: out.length,
    });
    return out;
  }

  return { listAccounts, listTransactions, listBudgets };
}

/**
 * Exposed for tests. Normalization + milliunit conversion without a
 * full Nango mock.
 */
export const __internal = {
  normalizeAccount,
  normalizeTransaction,
  normalizeBudgetCategory,
  milliunitsToCents,
  mapAccountKind,
  parseRetryAfter,
};
