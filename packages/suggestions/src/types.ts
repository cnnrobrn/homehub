/**
 * Shared types for `@homehub/suggestions`.
 *
 * Each generator is a two-phase function:
 *   1. Deterministic candidate selection (pure over in-memory rows).
 *   2. Optional model-drafted rationale via a caller-supplied writer.
 *
 * The generator itself never touches the DB or the model — the
 * suggestions worker owns both side effects. This keeps the generators
 * pure + easy to unit test with fixtures.
 */

import { type Segment } from '@homehub/shared';

/**
 * The worker translates these into `app.suggestion` rows:
 *
 * ```
 * insert into app.suggestion (
 *   household_id, segment, kind, title, rationale, preview, status
 * ) values (
 *   $1, emission.segment, emission.kind, emission.title,
 *   emission.rationale, emission.preview, 'pending'
 * )
 * ```
 *
 * `dedupeKey` is not persisted in a dedicated column; the worker keeps
 * it on `preview.dedupe_key` and uses it to skip emissions whose
 * equivalent row already exists as pending/approved.
 */
export interface SuggestionEmission {
  segment: Segment;
  /** Short catalog id — e.g. `meal_swap`, `grocery_order`, `new_dish`. */
  kind: string;
  /** Member-visible summary. One short sentence. */
  title: string;
  /** One-paragraph justification. The model-drafted path overwrites this. */
  rationale: string;
  /**
   * Structured preview payload the UI renders on the suggestion card.
   * Shape is kind-specific; consumers type-narrow on `kind` + `preview`.
   */
  preview: Record<string, unknown>;
  /** Stable key so re-runs produce identical rows. */
  dedupeKey: string;
}

/**
 * Optional rationale writer. When a generator wants an LLM-polished
 * `rationale`, the worker injects this with a per-household
 * budget-guard-bound closure (see `apps/workers/suggestions`). In tests
 * + budget-degraded paths it's undefined and the deterministic
 * `rationale` stays.
 */
export type RationaleWriter = (input: {
  kind: string;
  candidate: Record<string, unknown>;
  fallback: string;
}) => Promise<string>;
