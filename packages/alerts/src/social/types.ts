/**
 * Social-segment detector input types.
 *
 * Mirrors the `financial` sibling: the detectors here are pure
 * functions that return `AlertEmission` objects. The alerts worker
 * loads the `app.event`, `mem.episode`, `mem.fact`, `mem.node`, and
 * `app.suggestion` rows and hands them to these detectors.
 *
 * Shape notes:
 *   - `SocialPersonNode` — the graph `mem.node type='person'` a
 *     household tracks. `metadata` may carry `last_seen_at` populated
 *     by the reconciler; when absent we fall back to episode scan.
 *   - `SocialEvent` — minimal subset of `app.event` rows for
 *     birthday/anniversary kinds (those that the materializer wrote).
 *   - `SocialEpisode` — minimal `mem.episode` shape (we only need
 *     participants + place + occurred_at).
 *
 * All detectors ignore cross-household rows by filtering on
 * `householdId` defensively.
 */

export interface SocialPersonNode {
  id: string;
  household_id: string;
  canonical_name: string;
  metadata: Record<string, unknown>;
  needs_review: boolean;
  created_at: string;
}

export interface SocialEvent {
  id: string;
  household_id: string;
  kind: string;
  title: string;
  starts_at: string;
  all_day: boolean;
  metadata: Record<string, unknown>;
}

export interface SocialEpisode {
  id: string;
  household_id: string;
  occurred_at: string;
  participants: string[];
  place_node_id: string | null;
  source_type: string;
  metadata: Record<string, unknown>;
}

export interface SocialSuggestionSnapshot {
  id: string;
  household_id: string;
  segment: string;
  kind: string;
  status: string;
  created_at: string;
  preview: Record<string, unknown>;
}

/**
 * The household's own "home" place node ids. When a reciprocity
 * detector decides an episode was hosted-by-us, it checks whether
 * `place_node_id` is in this set; when visited-them, the episode's
 * place node is not in the set.
 *
 * Populated by the worker from `household.settings.social.home_place_node_ids`
 * (optional) or falls back to `mem.node where type='place' and metadata->>is_home='true'`.
 */
export type HomePlaceSet = ReadonlySet<string>;
