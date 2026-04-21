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
  type AccountRow,
  type BudgetRow,
  type FinancialSummaryInput,
  type FinancialSummaryMetrics,
  type FinancialSummaryOutput,
  type SummaryPeriod,
  type TransactionRow,
} from './types.js';
