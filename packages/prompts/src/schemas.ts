/**
 * Zod schemas for prompt outputs.
 *
 * Each schema matches the JSON contract documented inside the prompt's
 * own markdown file (`## JSON Schema` section). Schemas are the
 * machine-enforceable half of the contract — the prose in the markdown
 * is the humans-readable half. If they drift, the schema wins at
 * runtime and the prompt is out of date.
 *
 * Spec anchors:
 *   - `specs/04-memory-network/extraction.md` — extraction contract.
 *   - `specs/04-memory-network/temporal.md` — bi-temporal columns.
 *   - `specs/05-agents/model-routing.md` — structured-output discipline.
 */

import { z } from 'zod';

/**
 * Episode as emitted by the extractor. `mentions_facts` references the
 * in-response `facts[].id` values; after extraction the worker resolves
 * those ids to real `mem.fact_candidate` ids during the write step.
 */
export const extractionEpisodeSchema = z.object({
  occurred_at: z.iso.datetime({ offset: true }),
  ended_at: z.iso.datetime({ offset: true }).optional(),
  title: z.string().min(1),
  summary: z.string(),
  /**
   * Free-form node references: `"person:Sarah"`, `"person:alice@example.com"`,
   * `"place:Giulia's"`, or a bare email / display name. The worker
   * resolves each reference to a `mem.node` (creating one when needed)
   * before writing the episode.
   */
  participants: z.array(z.string()),
  place_reference: z.string().optional(),
  /** Forward references to `facts[].id`. */
  mentions_facts: z.array(z.string()),
});
export type ExtractionEpisode = z.infer<typeof extractionEpisodeSchema>;

/**
 * Atomic fact as emitted by the extractor. Matches the extraction
 * contract in `specs/04-memory-network/extraction.md`:
 *
 *     (subject, predicate, object[, qualifier])
 *
 * plus confidence, evidence, and a temporal hint. Either `object_value`
 * (primitive / JSON blob) or `object_node_reference` (a resolver hint)
 * is expected; both may be present when the model is uncertain.
 *
 * `valid_from` is either an ISO datetime or the literal string
 * `"inferred"` meaning "use recorded_at as a proxy for when we first
 * saw this."
 */
export const extractionFactSchema = z.object({
  /** In-response id; referenced by episodes.mentions_facts. */
  id: z.string().min(1),
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object_value: z.unknown().optional(),
  object_node_reference: z.string().optional(),
  confidence: z.number().min(0).max(1),
  evidence: z.string(),
  valid_from: z.union([z.iso.datetime({ offset: true }), z.literal('inferred')]),
  qualifier: z.record(z.string(), z.unknown()).optional(),
});
export type ExtractionFact = z.infer<typeof extractionFactSchema>;

/**
 * The full event-extraction response envelope. Top-level shape matches
 * the prompt's `## JSON Schema` section.
 */
export const eventExtractionSchema = z.object({
  episodes: z.array(extractionEpisodeSchema),
  facts: z.array(extractionFactSchema),
});
export type EventExtractionResponse = z.infer<typeof eventExtractionSchema>;

/**
 * Narrow schema used by the model-backed event classifier. Mirrors the
 * deterministic classifier's `EventClassification` shape from
 * `packages/enrichment/src/types.ts` so the worker can swap paths
 * without reshaping downstream consumers.
 */
export const eventClassifierSchema = z.object({
  segment: z.enum(['financial', 'food', 'fun', 'social', 'system']),
  kind: z.enum([
    'reservation',
    'meeting',
    'birthday',
    'anniversary',
    'travel',
    'bill',
    'subscription',
    'unknown',
  ]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  /** Model-space signals; maps to `EventClassification.signals`. */
  signals: z.array(z.string()),
});
export type EventClassifierResponse = z.infer<typeof eventClassifierSchema>;

/**
 * Schema used by the node-regen prompt: the model returns a single
 * markdown document. We don't constrain headings, but we do require a
 * non-empty string.
 */
export const nodeDocSchema = z.object({
  document_md: z.string().min(1),
});
export type NodeDocResponse = z.infer<typeof nodeDocSchema>;
