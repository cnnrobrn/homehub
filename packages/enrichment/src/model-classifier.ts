/**
 * Model-backed event classifier.
 *
 * Wraps a `ModelClient.generate()` call against the
 * `extraction/event-classifier` prompt. Returns the same
 * `EventClassification` shape the deterministic classifier emits, so
 * the enrichment worker can use them interchangeably behind the
 * pipeline's fallback wrapper.
 *
 * Spec: `specs/05-agents/model-routing.md` (Kimi K2 background tier,
 * JSON mode, prompt cache) + `specs/04-memory-network/extraction.md`
 * (structured-output discipline).
 *
 * Error contract: any failure — schema invalid, HTTP error, prompt
 * load / render error — surfaces as a `ModelClassifierError` with the
 * original cause preserved. The enrichment pipeline catches it and
 * falls back to the deterministic classifier.
 */

import {
  eventClassifierSchema,
  loadPrompt,
  renderPrompt,
  type EventClassifierResponse,
} from '@homehub/prompts';
import { type HouseholdId } from '@homehub/shared';
import { type Logger, type ModelClient } from '@homehub/worker-runtime';

import { ModelClassifierError } from './errors.js';
import { type EventClassification, type EventInput } from './types.js';

/**
 * Cost / version tag written into `metadata.enrichment.version` by the
 * worker. Bumping this triggers a backfill per
 * `specs/04-memory-network/enrichment-pipeline.md`.
 */
export const MODEL_CLASSIFIER_VERSION = '2026-04-20-kimi-k2-v1';

export interface CreateKimiEventClassifierOptions {
  modelClient: ModelClient;
  log: Logger;
}

interface ClassifyArgs {
  event: EventInput;
  householdId: HouseholdId;
  /** Short one-liner like "Acme household; 2 members." */
  householdContext?: string;
}

export interface ModelEventClassifier {
  classify(args: ClassifyArgs): Promise<EventClassification>;
}

/**
 * Format the attendee list for the prompt slot. Mirrors the
 * deterministic classifier's `EventInput.attendees` shape.
 */
function formatAttendees(event: EventInput): string {
  if (event.attendees.length === 0) return '(none)';
  return event.attendees
    .map((a) => (a.displayName ? `${a.displayName} <${a.email}>` : a.email))
    .join('\n');
}

export function createKimiEventClassifier(
  opts: CreateKimiEventClassifierOptions,
): ModelEventClassifier {
  const { modelClient, log } = opts;

  return {
    async classify({ event, householdId, householdContext }) {
      let prompt;
      try {
        prompt = loadPrompt('event-classifier');
      } catch (err) {
        throw new ModelClassifierError(
          `failed to load event-classifier prompt: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }

      let rendered;
      try {
        rendered = renderPrompt(prompt, {
          household_context: householdContext ?? '(none supplied)',
          title: event.title || '(no title)',
          description: event.description ?? '(none)',
          location: event.location ?? '(none)',
          starts_at: event.startsAt,
          ends_at: event.endsAt ?? '(none)',
          all_day: event.allDay ? 'true' : 'false',
          provider: event.provider ?? '(unknown)',
          owner_email: event.ownerEmail,
          attendees: formatAttendees(event),
        });
      } catch (err) {
        throw new ModelClassifierError(
          `failed to render event-classifier prompt: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }

      let parsed: EventClassifierResponse | undefined;
      try {
        const result = await modelClient.generate({
          task: 'enrichment.event.classify',
          household_id: householdId,
          systemPrompt: rendered.systemPrompt,
          userPrompt: rendered.userPrompt,
          schema: eventClassifierSchema,
          temperature: 0.2,
          maxOutputTokens: 400,
          cache: 'auto',
        });
        parsed = result.parsed;
      } catch (err) {
        throw new ModelClassifierError(
          `model event-classifier call failed: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }

      if (!parsed) {
        // Should be unreachable — generate() returns parsed when a
        // schema is provided. Defensive surface.
        throw new ModelClassifierError('model event-classifier returned no parsed output');
      }

      // `signals` may be empty in the response; downstream callers
      // require at least one signal so the audit trail isn't empty.
      const signals = parsed.signals.length > 0 ? parsed.signals : [`model.${prompt.version}`];

      const classification: EventClassification = {
        segment: parsed.segment,
        kind: parsed.kind,
        confidence: parsed.confidence,
        rationale: parsed.rationale,
        signals,
      };

      log.debug('model event-classifier returned', {
        household_id: householdId,
        segment: classification.segment,
        kind: classification.kind,
        confidence: classification.confidence,
        signals: classification.signals,
      });
      return classification;
    },
  };
}
