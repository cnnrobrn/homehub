/**
 * `@homehub/alerts` — deterministic alert detectors.
 *
 * Each detector is a pure function over in-memory inputs (transactions,
 * accounts, budgets, subscription nodes). They return zero-or-more
 * `AlertEmission` objects; the alerts worker is responsible for:
 *   - loading the inputs from `app.*` / `mem.*`,
 *   - deduping against active alerts via `(kind, dedupeKey)`,
 *   - inserting `app.alert` rows.
 *
 * No model calls. No database access. Safe to re-run without cost.
 */

export {
  DEFAULT_HOUSEHOLD_ALERT_SETTINGS,
  type AccountRow,
  type AlertEmission,
  type AlertSeverity,
  type BudgetRow,
  type HouseholdAlertSettings,
  type SubscriptionNode,
  type TransactionRow,
} from './types.js';

export {
  BUDGET_CRITICAL_PCT,
  BUDGET_WARN_PCT,
  detectBudgetOverThreshold,
  startOfPeriod,
  type BudgetThresholdInput,
} from './financial/budget-over-threshold.js';

export {
  PAYMENT_FAILED_LOOKBACK_DAYS,
  detectPaymentFailed,
  type PaymentFailedInput,
} from './financial/payment-failed.js';

export {
  LARGE_TRANSACTION_LOOKBACK_DAYS,
  detectLargeTransaction,
  type LargeTransactionInput,
} from './financial/large-transaction.js';

export {
  PRICE_INCREASE_THRESHOLD_PCT,
  detectSubscriptionPriceIncrease,
  type SubscriptionPriceInput,
} from './financial/subscription-price-increase.js';

export {
  ACCOUNT_STALE_THRESHOLD_HOURS,
  detectAccountStale,
  type AccountStaleInput,
} from './financial/account-stale.js';

export {
  DUPLICATE_AMOUNT_TOLERANCE_CENTS,
  DUPLICATE_TIME_WINDOW_HOURS,
  detectDuplicateCharge,
  type DuplicateChargeInput,
} from './financial/duplicate-charge.js';

export {
  detectNewRecurringCharge,
  type NewRecurringChargeInput,
} from './financial/new-recurring-charge.js';

export {
  SUBSCRIPTION_AMOUNT_TOLERANCE_PCT,
  SUBSCRIPTION_LOOKBACK_DAYS,
  SUBSCRIPTION_MIN_CHARGES,
  classifyCadence,
  detectSubscriptions,
  type DetectSubscriptionsInput,
  type SubscriptionCadence,
  type SubscriptionCandidate,
} from './subscription-detector.js';
