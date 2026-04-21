/**
 * Public type surface for the M2 deterministic event classifier.
 *
 * `EventInput` mirrors the subset of `app.event` columns the classifier
 * actually reads. The enrichment worker builds this from a row + the
 * `metadata.attendees` array written by `sync-gcal` (see
 * `apps/workers/sync-gcal/src/handler.ts#upsertEventsPage`).
 *
 * `EventClassification` is what the classifier emits. It's intentionally
 * atomic per `specs/04-memory-network/extraction.md`:
 *   - `segment` is a single enum value.
 *   - `signals` is an ordered array of rule names that matched, so the
 *     reason for the classification is machine-parseable (not a prose
 *     blob). `rationale` is the human-readable sibling.
 *
 * In M3 this interface stays stable but a `ModelBackedEventClassifier`
 * implementation is added that swaps the regex/keyword logic for a
 * Kimi K2 call. The consumer (enrichment worker) should not need to
 * change shape.
 */

import { z } from 'zod';

/**
 * Allowed segments, in the same order the CHECK constraint on
 * `app.event.segment` lists them. `'system'` is the "not classified"
 * sentinel — calendar rows land with it and this classifier replaces it.
 */
export const eventSegmentSchema = z.enum(['financial', 'food', 'fun', 'social', 'system']);
export type EventSegment = z.infer<typeof eventSegmentSchema>;

/**
 * Narrow sub-kind within a segment. These are free-form strings: the DB
 * does not constrain `app.event.kind` to an enum, so we use a small
 * shared vocabulary agreed in the M2-B dispatch.
 */
export const eventKindSchema = z.enum([
  'reservation',
  'meeting',
  'birthday',
  'anniversary',
  'travel',
  'bill',
  'subscription',
  'unknown',
]);
export type EventKind = z.infer<typeof eventKindSchema>;

export const eventInputAttendeeSchema = z.object({
  email: z.email(),
  displayName: z.string().optional(),
});
export type EventInputAttendee = z.infer<typeof eventInputAttendeeSchema>;

/**
 * Shape of the event the classifier consumes. All string fields are
 * pre-trimmed by the caller; the classifier does not mutate inputs.
 */
export const eventInputSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }).optional(),
  allDay: z.boolean(),
  attendees: z.array(eventInputAttendeeSchema),
  ownerEmail: z.email(),
  provider: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type EventInput = z.infer<typeof eventInputSchema>;

export const eventClassificationSchema = z.object({
  segment: eventSegmentSchema,
  kind: eventKindSchema,
  /** Model-space confidence, [0, 1]. Deterministic path uses 0.2/0.6/0.9. */
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  signals: z.array(z.string()).min(1),
});
export type EventClassification = z.infer<typeof eventClassificationSchema>;

export interface EventClassifier {
  classify(event: EventInput): EventClassification;
}

/**
 * Tag embedded in `metadata.enrichment.version`. Bumped when the
 * classifier's rule set changes materially so M3's model-backed path can
 * find-and-reclassify rows that are still on the deterministic output.
 */
export const DETERMINISTIC_CLASSIFIER_VERSION = '2026-04-20-deterministic-v1';
