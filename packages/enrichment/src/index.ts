/**
 * `@homehub/enrichment` — barrel.
 *
 * M2 surface: the deterministic `EventClassifier` and its types.
 * M3 will add a `ModelBackedEventClassifier` behind the same interface
 * plus extraction-side helpers. Keep exports narrow — every new name is
 * a commitment for every downstream consumer.
 */

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
