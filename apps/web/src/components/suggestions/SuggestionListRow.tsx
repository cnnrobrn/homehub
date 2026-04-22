/**
 * Superseded by `<DecisionItem />`.
 *
 * The `/suggestions` page previously rendered a neutral-grey
 * `<SuggestionListRow />` for every pending row. The V2 Indie Decisions
 * surface now composes `DecisionCard` directly via
 * `<DecisionItem />` — keep that component as the single entry point
 * for any caller that needs to surface a suggestion row.
 *
 * This module re-exports the new component under the old name to keep
 * deep-links and any stray imports resolvable during the rollout. No
 * new code should import from this path.
 */

export { DecisionItem as SuggestionListRow } from './DecisionItem';
export type { DecisionItemProps as SuggestionListRowProps } from './DecisionItem';
