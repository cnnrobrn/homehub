/**
 * `@homehub/alerts/social` — deterministic social-segment detectors.
 *
 * Each detector is a pure function over in-memory graph + event rows.
 * The alerts worker's `runAlertsWorker` loads the inputs and calls
 * these in the same pass that runs the financial detectors; both feed
 * into the shared `app.alert` table deduped by `(kind, dedupeKey)`.
 */

export {
  BIRTHDAY_APPROACHING_WINDOW_DAYS,
  detectBirthdayApproaching,
  type BirthdayApproachingInput,
} from './birthday-approaching.js';

export {
  ABSENCE_LOOKBACK_DAYS,
  ABSENCE_THRESHOLD_DAYS,
  MIN_RECENT_EPISODES,
  detectAbsenceLong,
  type AbsenceLongInput,
} from './absence-long.js';

export {
  RECIPROCITY_LOOKBACK_DAYS,
  RECIPROCITY_MIN_HOSTED,
  RECIPROCITY_RATIO,
  detectReciprocityImbalance,
  type ReciprocityImbalanceInput,
} from './reciprocity-imbalance.js';

export {
  CONFLICTING_BIRTHDAY_WINDOW_DAYS,
  detectConflictingBirthdayNoPlan,
  type ConflictingBirthdayNoPlanInput,
} from './conflicting-birthday-no-plan.js';

export {
  type HomePlaceSet,
  type SocialEpisode,
  type SocialEvent,
  type SocialPersonNode,
  type SocialSuggestionSnapshot,
} from './types.js';
