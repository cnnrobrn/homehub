/**
 * Financial segment server helpers.
 *
 * All readers are household-scoped, RLS-enforced, and grant-aware. Use
 * them from Server Components (or other server-side code); never
 * import these from Client Components — data should flow via props /
 * server actions.
 */

export {
  hasFinancialRead,
  listTransactions,
  listTransactionsArgsSchema,
  TRANSACTION_SOURCES,
  TRANSACTION_STATUSES,
  type ListTransactionsArgs,
  type SegmentGrant,
  type TransactionRow,
  type TransactionSource,
  type TransactionStatus,
} from './listTransactions';

export {
  listAccounts,
  listAccountsArgsSchema,
  type AccountRow,
  type ListAccountsArgs,
} from './listAccounts';

export {
  listBudgets,
  listBudgetsArgsSchema,
  type BudgetRow,
  type ListBudgetsArgs,
} from './listBudgets';

export {
  listSubscriptions,
  listSubscriptionsArgsSchema,
  type ListSubscriptionsArgs,
  type SubscriptionCadence,
  type SubscriptionRow,
} from './listSubscriptions';

export {
  ALERT_SEVERITIES,
  listFinancialAlerts,
  listFinancialAlertsArgsSchema,
  type AlertSeverity,
  type FinancialAlertRow,
  type ListFinancialAlertsArgs,
} from './listFinancialAlerts';

export {
  listFinancialSummaries,
  listFinancialSummariesArgsSchema,
  type FinancialSummaryRow,
  type ListFinancialSummariesArgs,
} from './listFinancialSummaries';

export {
  listFinancialSuggestions,
  listFinancialSuggestionsArgsSchema,
  type FinancialSuggestionRow,
  type ListFinancialSuggestionsArgs,
} from './listFinancialSuggestions';
