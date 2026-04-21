/**
 * Shared types for social-segment suggestion generators.
 *
 * Generators live in this folder and each consumes a narrowly-typed
 * in-memory input shape. The suggestions worker owns loading these
 * rows and persisting the emissions.
 */

export interface SocialPersonRow {
  id: string;
  household_id: string;
  canonical_name: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

/** Raw `mem.fact` row the generator reads for preferences / prior gifts. */
export interface SocialFactRow {
  id: string;
  household_id: string;
  subject_node_id: string;
  predicate: string;
  object_value: unknown;
  object_node_id: string | null;
  valid_to: string | null;
  superseded_at: string | null;
  recorded_at: string;
}

export interface SocialEpisodeRow {
  id: string;
  household_id: string;
  occurred_at: string;
  participants: string[];
  place_node_id: string | null;
}

export interface SocialEventRow {
  id: string;
  household_id: string;
  kind: string;
  title: string;
  starts_at: string;
  all_day: boolean;
  metadata: Record<string, unknown>;
}

/**
 * `personNodeId -> { lastSeenAt, canonicalName }` used by the reach-out
 * generator. The alerts worker already computed this (the absence_long
 * detector) and hands the result to the suggestions worker.
 */
export interface AbsentPersonInfo {
  personNodeId: string;
  canonicalName: string;
  lastSeenAt: string | null;
  daysSince: number;
}

/**
 * `HomePlaceSet` mirrors the alerts-package type: node ids that the
 * household considers their home. The reciprocity generator uses it.
 */
export type HomePlaceSet = ReadonlySet<string>;
