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

// Fun-segment detectors.
export {
  CONFLICTING_RSVPS_DEFAULT_LOOKAHEAD_DAYS,
  RESERVATION_REMINDER_LOOKAHEAD_HOURS,
  TRIP_PREP_LOOKAHEAD_DAYS,
  detectConflictingRsvps,
  detectTicketReservationReminder,
  detectUpcomingTripPrep,
  getAttendeeEmails,
  getTripId,
  type ConflictingRsvpsInput,
  type FunEventRow,
  type TicketReservationReminderInput,
  type UpcomingTripPrepInput,
} from './fun/index.js';

// Food-segment detectors.
export {
  type GroceryListRow as FoodGroceryListRow,
  type MealRow as FoodMealRow,
  type PantryItemRow,
} from './food/types.js';

export {
  PANTRY_EXPIRING_DAYS,
  detectPantryExpiring,
  type PantryExpiringInput,
} from './food/pantry-expiring.js';

export {
  MEAL_PLAN_HORIZON_DAYS,
  detectMealPlanGap,
  type MealPlanGapInput,
} from './food/meal-plan-gap.js';

export {
  GROCERY_ORDER_ISSUE_LOOKBACK_HOURS,
  detectGroceryOrderIssue,
  type GroceryOrderIssueInput,
} from './food/grocery-order-issue.js';

// Social-segment detectors.
export {
  ABSENCE_LOOKBACK_DAYS,
  ABSENCE_THRESHOLD_DAYS,
  BIRTHDAY_APPROACHING_WINDOW_DAYS,
  CONFLICTING_BIRTHDAY_WINDOW_DAYS,
  MIN_RECENT_EPISODES,
  RECIPROCITY_LOOKBACK_DAYS,
  RECIPROCITY_MIN_HOSTED,
  RECIPROCITY_RATIO,
  detectAbsenceLong,
  detectBirthdayApproaching,
  detectConflictingBirthdayNoPlan,
  detectReciprocityImbalance,
  type AbsenceLongInput,
  type BirthdayApproachingInput,
  type ConflictingBirthdayNoPlanInput,
  type HomePlaceSet,
  type ReciprocityImbalanceInput,
  type SocialEpisode,
  type SocialEvent,
  type SocialPersonNode,
  type SocialSuggestionSnapshot,
} from './social/index.js';
