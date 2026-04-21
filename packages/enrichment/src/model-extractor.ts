/**
 * Model-backed event extractor.
 *
 * Wraps `ModelClient.generate()` against the `extraction/event`
 * prompt. Emits a structured `ExtractionResult` of episodes + facts
 * shaped for the enrichment worker's write phase. Does NOT write to
 * the DB — that's the worker's and reconciler's responsibility.
 *
 * Spec: `specs/04-memory-network/extraction.md` (extraction contract)
 * + `specs/05-agents/model-routing.md` (Kimi K2 default, JSON mode).
 *
 * Error contract: failures surface as `ModelExtractorError`. The
 * enrichment pipeline falls back to an empty extraction result on
 * error so classification still succeeds; a failed extraction is
 * non-fatal for the event.
 */

import {
  eventExtractionSchema,
  loadPrompt,
  renderPrompt,
  type EventExtractionResponse,
} from '@homehub/prompts';
import { type HouseholdId } from '@homehub/shared';
import { type Logger, type ModelClient } from '@homehub/worker-runtime';

import { ModelExtractorError } from './errors.js';
import { type EventInput } from './types.js';

/** Version tag stamped on `mem.fact_candidate.evidence[].prompt_version`. */
export const EVENT_EXTRACTOR_PROMPT_VERSION = '2026-04-20-kimi-k2-v1';

/**
 * Household-shaped hints the extractor passes through to the model so
 * it can resolve references against the real roster rather than
 * hallucinating `person:Unknown`.
 */
export interface HouseholdContext {
  householdId: HouseholdId;
  /** Short sentence like "Acme household; 2 adults + 2 kids." */
  summary?: string;
  /** Short names the model can reference as `person:<name>`. */
  peopleRoster: Array<{ id: string; name: string; aliases?: string[] }>;
  /** Short names the model can reference as `place:<name>`. */
  placeRoster: Array<{ id: string; name: string; aliases?: string[] }>;
}

export type ExtractionResult = EventExtractionResponse;

export interface ModelEventExtractor {
  extract(args: {
    event: EventInput;
    context: HouseholdContext;
    existingEnrichment?: unknown;
  }): Promise<ExtractionResult>;
}

export interface CreateKimiEventExtractorOptions {
  modelClient: ModelClient;
  log: Logger;
}

function formatAttendees(event: EventInput): string {
  if (event.attendees.length === 0) return '(none)';
  return event.attendees
    .map((a) => (a.displayName ? `${a.displayName} <${a.email}>` : a.email))
    .join('\n');
}

function formatPeople(roster: HouseholdContext['peopleRoster']): string {
  if (roster.length === 0) return '(no known people)';
  return roster
    .map((p) => {
      const aliases = p.aliases && p.aliases.length > 0 ? ` (aka ${p.aliases.join(', ')})` : '';
      return `- person:${p.name}${aliases}`;
    })
    .join('\n');
}

function formatPlaces(roster: HouseholdContext['placeRoster']): string {
  if (roster.length === 0) return '(no known places)';
  return roster
    .map((p) => {
      const aliases = p.aliases && p.aliases.length > 0 ? ` (aka ${p.aliases.join(', ')})` : '';
      return `- place:${p.name}${aliases}`;
    })
    .join('\n');
}

export function createKimiEventExtractor(
  opts: CreateKimiEventExtractorOptions,
): ModelEventExtractor {
  const { modelClient, log } = opts;

  return {
    async extract({ event, context, existingEnrichment }) {
      let prompt;
      try {
        prompt = loadPrompt('event');
      } catch (err) {
        throw new ModelExtractorError(
          `failed to load event prompt: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }

      let rendered;
      try {
        rendered = renderPrompt(prompt, {
          household_context: context.summary ?? '(none supplied)',
          household_people: formatPeople(context.peopleRoster),
          household_places: formatPlaces(context.placeRoster),
          title: event.title || '(no title)',
          description: event.description ?? '(none)',
          location: event.location ?? '(none)',
          starts_at: event.startsAt,
          ends_at: event.endsAt ?? '(none)',
          all_day: event.allDay ? 'true' : 'false',
          provider: event.provider ?? '(unknown)',
          owner_email: event.ownerEmail,
          attendees: formatAttendees(event),
          existing_enrichment: existingEnrichment ? JSON.stringify(existingEnrichment) : '(none)',
        });
      } catch (err) {
        throw new ModelExtractorError(
          `failed to render event prompt: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }

      let parsed: ExtractionResult | undefined;
      try {
        const result = await modelClient.generate({
          task: 'enrichment.event',
          household_id: context.householdId,
          systemPrompt: rendered.systemPrompt,
          userPrompt: rendered.userPrompt,
          schema: eventExtractionSchema,
          temperature: 0.2,
          maxOutputTokens: 2000,
          cache: 'auto',
        });
        parsed = result.parsed;
      } catch (err) {
        throw new ModelExtractorError(
          `model event-extractor call failed: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }

      if (!parsed) {
        throw new ModelExtractorError('model event-extractor returned no parsed output');
      }

      log.debug('model event-extractor returned', {
        household_id: context.householdId,
        episodes: parsed.episodes.length,
        facts: parsed.facts.length,
      });
      return parsed;
    },
  };
}
