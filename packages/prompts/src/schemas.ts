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

/**
 * Atomic fact emitted by the conversation extractor (M3.5). Mirrors
 * `extractionFactSchema` but with two differences:
 *   - `object_value` may be `null` to signal a member-requested deletion
 *     (combined with a non-null `valid_to`, the reconciler's
 *     member-delete branch soft-deletes the canonical fact).
 *   - `valid_to` is allowed, since negations like "Sarah isn't
 *     vegetarian anymore" close an interval as part of the extraction
 *     itself.
 *
 * Callers cap the model-reported confidence at 0.85 before writing to
 * `mem.fact_candidate`; the prompt tells the model this ceiling but the
 * worker enforces it.
 */
export const conversationFactSchema = z.object({
  id: z.string().min(1),
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object_value: z.unknown().nullable().optional(),
  object_node_reference: z.string().optional(),
  confidence: z.number().min(0).max(1),
  evidence: z.string(),
  valid_from: z.union([z.iso.datetime({ offset: true }), z.literal('inferred')]),
  valid_to: z.iso.datetime({ offset: true }).optional(),
  qualifier: z.record(z.string(), z.unknown()).optional(),
});
export type ConversationFact = z.infer<typeof conversationFactSchema>;

/**
 * Rule emitted by the conversation extractor. Rules are member-authored
 * household policies; they skip the candidate pool and go straight into
 * `mem.rule`. `predicate_dsl` is a structured JSON representation the
 * suggestion engine evaluates at runtime — the shape is defined by the
 * consumer, not this schema.
 */
export const conversationRuleSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  predicate_dsl: z.record(z.string(), z.unknown()),
});
export type ConversationRule = z.infer<typeof conversationRuleSchema>;

/**
 * Conversation-extraction envelope. Unlike `eventExtractionSchema`,
 * there are no episodes here — conversation episodes flow through the
 * separate `rollup/conversation` prompt path which writes `mem.episode`
 * rows directly.
 */
export const conversationExtractionSchema = z.object({
  facts: z.array(conversationFactSchema),
  rules: z.array(conversationRuleSchema),
});
export type ConversationExtractionResponse = z.infer<typeof conversationExtractionSchema>;

/**
 * Conversation-rollup output. One episode per substantive conversation
 * window, written by the rollup worker into `mem.episode` with
 * `source_type='conversation'`.
 */
export const conversationRollupSchema = z.object({
  title: z.string().min(1),
  summary: z.string(),
  participants: z.array(z.string()),
  place_reference: z.string().optional(),
  occurred_at: z.iso.datetime({ offset: true }),
  ended_at: z.iso.datetime({ offset: true }).optional(),
});
export type ConversationRollupResponse = z.infer<typeof conversationRollupSchema>;

/**
 * Atomic fact emitted by the per-entity consolidation prompt (M3.7-A).
 * Same atomic triple shape as the extractor, but evidence MUST reference
 * ≥2 episode ids (the prompt enforces this; the schema is permissive on
 * string content — evidence is free-form text). Consolidation-sourced
 * candidates flow through the standard reconciler with `source =
 * 'consolidation'`.
 */
export const consolidationFactSchema = z.object({
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object_value: z.unknown().optional(),
  object_node_reference: z.string().optional(),
  confidence: z.number().min(0).max(1),
  evidence: z.string().min(1),
  valid_from: z.union([z.iso.datetime({ offset: true }), z.literal('inferred')]),
  qualifier: z.record(z.string(), z.unknown()).optional(),
});
export type ConsolidationFact = z.infer<typeof consolidationFactSchema>;

/**
 * Per-entity consolidation envelope. A nightly pass over one entity's
 * canonical facts + recent episodes produces zero-or-more candidate
 * facts. An empty array is valid and means "no new pattern emerged."
 */
export const entityConsolidationSchema = z.object({
  facts: z.array(consolidationFactSchema),
});
export type EntityConsolidationResponse = z.infer<typeof entityConsolidationSchema>;

/**
 * Weekly reflection output (M3.7-A). The reflector emits a short
 * markdown body plus id lists the reader can trace back to. The lists
 * are authoritative for what the body leans on; the body itself is
 * prose. Cited ids are required to be non-empty on `cited_episodes`
 * or `cited_patterns` in non-trivial weeks, but the schema is
 * permissive — the worker logs a warning when all three are empty
 * rather than rejecting the response.
 */
export const weeklyReflectionSchema = z.object({
  body_md: z.string().min(1),
  cited_episodes: z.array(z.string()),
  cited_facts: z.array(z.string()),
  cited_patterns: z.array(z.string()),
});
export type WeeklyReflectionResponse = z.infer<typeof weeklyReflectionSchema>;

/**
 * Episode emitted by the email extractor (M4-B). `kind` tags the
 * heuristic category that drove the episode; `subject_reference` is a
 * HomeHub node-reference string (e.g. `merchant:Trader Joe's`,
 * `place:Giulia's`) that the worker resolves to `mem.node` rows.
 * `attributes` is a free-form JSON blob per kind (merchant/amount/
 * party_size/tracking_number/…).
 */
export const emailExtractionEpisodeSchema = z.object({
  kind: z.enum(['receipt', 'reservation', 'bill', 'invite', 'shipment']),
  occurred_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }).optional(),
  title: z.string().min(1),
  summary: z.string(),
  subject_reference: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()),
});
export type EmailExtractionEpisode = z.infer<typeof emailExtractionEpisodeSchema>;

/**
 * Atomic fact emitted by the email extractor. Same triple shape as the
 * event extractor, but without `qualifier` (email sources rarely need
 * it; add if we see real demand). Evidence is a short quote / para-
 * phrase drawn from the email.
 */
export const emailExtractionFactSchema = z.object({
  id: z.string().min(1),
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object_value: z.unknown().optional(),
  object_node_reference: z.string().optional(),
  confidence: z.number().min(0).max(1),
  evidence: z.string(),
  valid_from: z.union([z.iso.datetime({ offset: true }), z.literal('inferred')]),
});
export type EmailExtractionFact = z.infer<typeof emailExtractionFactSchema>;

/**
 * Member-visible suggestion drafted by the email extractor. M4-B only
 * ships `add_to_calendar`; future milestones extend this with
 * bill-payment / shipping-arrival / subscription-renewal kinds. The
 * worker stamps `source_email_id` server-side — the model doesn't see
 * it, so the schema omits the field.
 */
export const emailSuggestionSchema = z.object({
  kind: z.literal('add_to_calendar'),
  title: z.string().min(1),
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }).optional(),
  location: z.string().optional(),
  attendees: z.array(z.string()),
  rationale: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type EmailSuggestion = z.infer<typeof emailSuggestionSchema>;

/**
 * The full email-extraction response envelope. Shape mirrors
 * `eventExtractionSchema` plus a `suggestions[]` channel that the
 * handler fans into `app.suggestion` rows with `status='pending'`.
 *
 * An empty response (`{episodes: [], facts: [], suggestions: []}`) is a
 * valid, expected output — many emails (newsletters, marketing) produce
 * nothing useful.
 */
export const emailExtractionSchema = z.object({
  episodes: z.array(emailExtractionEpisodeSchema),
  facts: z.array(emailExtractionFactSchema),
  suggestions: z.array(emailSuggestionSchema),
});
export type EmailExtractionResponse = z.infer<typeof emailExtractionSchema>;
