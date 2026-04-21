/**
 * `@homehub/enrichment` — barrel.
 *
 * M3 surface:
 *   - Deterministic classifier (M2 carry-over) and its types.
 *   - Model-backed classifier + extractor (M3-B).
 *   - Enrichment pipeline that fuses model + deterministic with
 *     budget-aware routing.
 *   - Reconciler that promotes `mem.fact_candidate` rows into
 *     canonical `mem.fact`.
 *   - Typed errors for each model-side failure mode.
 *
 * Keep exports narrow — every new name is a commitment for every
 * downstream consumer.
 */

// --- Deterministic classifier (M2) --------------------------------------
export {
  createDeterministicEventClassifier,
  DETERMINISTIC_CLASSIFIER_VERSION,
} from './classifier.js';

export {
  eventClassificationSchema,
  eventInputSchema,
  eventInputAttendeeSchema,
  eventKindSchema,
  eventSegmentSchema,
  type EventClassification,
  type EventClassifier,
  type EventInput,
  type EventInputAttendee,
  type EventKind,
  type EventSegment,
} from './types.js';

// --- Model-backed classifier (M3) ---------------------------------------
export {
  createKimiEventClassifier,
  MODEL_CLASSIFIER_VERSION,
  type ModelEventClassifier,
  type CreateKimiEventClassifierOptions,
} from './model-classifier.js';

// --- Model-backed extractor (M3) ----------------------------------------
export {
  createKimiEventExtractor,
  EVENT_EXTRACTOR_PROMPT_VERSION,
  type ModelEventExtractor,
  type ExtractionResult,
  type HouseholdContext,
  type CreateKimiEventExtractorOptions,
} from './model-extractor.js';

// --- Pipeline (M3) ------------------------------------------------------
export {
  createEnrichmentPipeline,
  type EnrichmentPipeline,
  type EnrichmentPipelineDeps,
  type ClassifyArgs,
  type ClassifyOutcome,
  type ExtractArgs,
  type ExtractOutcome,
} from './pipeline.js';

// --- Reconciler (M3) ----------------------------------------------------
export {
  reconcileCandidate,
  type ReconcileResult,
  type ReconcileOutcome,
} from './reconciler/reconcile.js';
export {
  DESTRUCTIVE_PREDICATES,
  DEFAULT_CONFIDENCE_THRESHOLD,
  DESTRUCTIVE_CONFIDENCE_THRESHOLD,
  CONFIDENCE_CAP,
  REINFORCEMENT_BUMP,
  jsonEqual,
  decideConflict,
  policyFor,
  type PredicatePolicy,
  type ConflictDecisionInput,
  type ConflictWinner,
} from './reconciler/policy.js';

// --- Errors (M3) --------------------------------------------------------
export { ModelClassifierError, ModelExtractorError } from './errors.js';
