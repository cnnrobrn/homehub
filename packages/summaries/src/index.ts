/**
 * `@homehub/summaries` — deterministic summary renderers.
 *
 * Exports:
 *   - `renderFinancialSummary` + `computeMetrics`: build body markdown
 *     and a structured metrics blob from in-memory `app.*` rows.
 *   - Types consumed by the summaries worker.
 */

export { computeMetrics, renderFinancialSummary } from './financial.js';

export {
  computeFunMetrics,
  renderFunSummary,
  type FunEventRow,
  type FunSummaryInput,
  type FunSummaryMetrics,
  type FunSummaryOutput,
} from './fun.js';

export { computeFoodMetrics, renderFoodSummary } from './food.js';

export { computeSocialMetrics, renderSocialSummary } from './social.js';

export {
  type AccountRow,
  type BudgetRow,
  type FinancialSummaryInput,
  type FinancialSummaryMetrics,
  type FinancialSummaryOutput,
  type FoodSummaryInput,
  type FoodSummaryMetrics,
  type FoodSummaryOutput,
  type MealSummaryRow,
  type PantryItemSummaryRow,
  type SocialAbsentPerson,
  type SocialEpisodeRow,
  type SocialEventRow,
  type SocialPersonRow,
  type SocialSummaryInput,
  type SocialSummaryMetrics,
  type SocialSummaryOutput,
  type SummaryPeriod,
  type TransactionRow,
} from './types.js';
