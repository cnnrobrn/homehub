/**
 * Model-backed email extractor (M4-B).
 *
 * Wraps `ModelClient.generate()` against the `extraction/email` prompt.
 * Emits (1) time-anchored episodes, (2) atomic facts, and (3) at most
 * one `add_to_calendar` suggestion per reservation / invite. Mirrors the
 * event-extractor's surface so the enrichment worker can dispatch the
 * `enrich_email` queue with the same reconciler plumbing.
 *
 * Spec: `specs/03-integrations/google-workspace.md` (what we ingest),
 * `specs/04-memory-network/extraction.md` (atomicity, two-stage write),
 * `specs/05-agents/suggestions.md` (suggestion surface),
 * `specs/05-agents/model-routing.md` (background tier, JSON mode on).
 *
 * Error contract: failures surface as `ModelExtractorError`. The
 * enrichment worker's dispatch catches the error and routes the
 * message to the DLQ; there is no deterministic fallback here — a
 * bad extraction is a prompt/model bug, not a parse-best-effort signal.
 *
 * Privacy: the full email body is passed in by the worker and cached in
 * a local variable only. This module never persists the body.
 */

import {
  emailExtractionSchema,
  loadPrompt,
  renderPrompt,
  type EmailExtractionResponse,
} from '@homehub/prompts';
import { type HouseholdId } from '@homehub/shared';
import { type Logger, type ModelClient } from '@homehub/worker-runtime';

import { ModelExtractorError } from './errors.js';

/** Version tag stamped on `mem.fact_candidate.evidence[].prompt_version`. */
export const EMAIL_EXTRACTOR_PROMPT_VERSION = '2026-04-20-email-v2';

/**
 * Max body bytes we pass to the model. The prompt caps at 2KB (see
 * `specs/03-integrations/google-workspace.md`); anything longer is
 * truncated to that ceiling before rendering. Caller is responsible for
 * passing the richest body it has (full body preferred; preview if the
 * full fetch failed).
 */
export const EMAIL_BODY_TRUNCATE_BYTES = 2048;

/**
 * Email-shaped input the extractor consumes. Mirrors the subset of
 * `app.email` columns the prompt needs, plus the `body` that the worker
 * obtains on-demand via `EmailProvider.fetchFullBody` (or the stored
 * `body_preview` when the full fetch is unavailable).
 */
export interface EmailInput {
  /** Primary key of the `app.email` row — stamped on suggestions as `source_email_id`. */
  emailId: string;
  subject: string;
  fromEmail: string;
  fromName?: string;
  receivedAt: string;
  /** Heuristic categories assigned at sync time. */
  categories: readonly string[];
  /** Full body if available; falls back to the stored preview otherwise. */
  body: string;
}

/**
 * Household-shaped hints the extractor passes through to the model so
 * it can resolve references against the real roster rather than
 * hallucinating `merchant:Unknown`.
 */
export interface EmailHouseholdContext {
  householdId: HouseholdId;
  /** Short sentence describing the household. */
  summary?: string;
  /** People the household talks about (for invite attendee resolution). */
  peopleRoster: Array<{ id: string; name: string; aliases?: string[] }>;
  /** Places the household has already named (restaurants, homes). */
  placeRoster: Array<{ id: string; name: string; aliases?: string[] }>;
  /** Merchants (billers, retailers) the household has already named. */
  merchantRoster: Array<{ id: string; name: string; aliases?: string[] }>;
}

export type EmailExtractionResult = EmailExtractionResponse;

export interface ModelEmailExtractor {
  extract(args: {
    email: EmailInput;
    context: EmailHouseholdContext;
  }): Promise<EmailExtractionResult>;
}

export interface CreateKimiEmailExtractorOptions {
  modelClient: ModelClient;
  log: Logger;
}

function formatRoster(
  roster: Array<{ name: string; aliases?: string[] }>,
  prefix: 'person' | 'place' | 'merchant',
  emptyLabel: string,
): string {
  if (roster.length === 0) return emptyLabel;
  return roster
    .map((p) => {
      const aliases = p.aliases && p.aliases.length > 0 ? ` (aka ${p.aliases.join(', ')})` : '';
      return `- ${prefix}:${p.name}${aliases}`;
    })
    .join('\n');
}

function formatFromHeader(input: EmailInput): string {
  if (input.fromName && input.fromName.length > 0) {
    return `"${input.fromName}" <${input.fromEmail}>`;
  }
  return input.fromEmail;
}

function truncateBytes(value: string, maxBytes: number): string {
  if (!value) return '';
  const buf = Buffer.from(value, 'utf8');
  if (buf.byteLength <= maxBytes) return value;
  // Slice on byte boundary but re-decode so we don't split a multibyte char.
  return buf.subarray(0, maxBytes).toString('utf8');
}

export function createKimiEmailExtractor(
  opts: CreateKimiEmailExtractorOptions,
): ModelEmailExtractor {
  const { modelClient, log } = opts;

  return {
    async extract({ email, context }) {
      let prompt;
      try {
        prompt = loadPrompt('email');
      } catch (err) {
        throw new ModelExtractorError(
          `failed to load email prompt: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }

      let rendered;
      try {
        rendered = renderPrompt(prompt, {
          household_context: context.summary ?? '(none supplied)',
          known_people: formatRoster(context.peopleRoster, 'person', '(no known people)'),
          known_places: formatRoster(context.placeRoster, 'place', '(no known places)'),
          known_merchants: formatRoster(context.merchantRoster, 'merchant', '(no known merchants)'),
          email_subject: email.subject || '(no subject)',
          email_from: formatFromHeader(email),
          email_received_at: email.receivedAt,
          email_categories: email.categories.length > 0 ? email.categories.join(', ') : '(none)',
          email_body_preview: truncateBytes(email.body ?? '', EMAIL_BODY_TRUNCATE_BYTES),
        });
      } catch (err) {
        throw new ModelExtractorError(
          `failed to render email prompt: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }

      let parsed: EmailExtractionResult | undefined;
      try {
        const result = await modelClient.generate({
          task: 'enrichment.email',
          household_id: context.householdId,
          systemPrompt: rendered.systemPrompt,
          userPrompt: rendered.userPrompt,
          schema: emailExtractionSchema,
          temperature: 0.15,
          maxOutputTokens: 1500,
          cache: 'auto',
        });
        parsed = result.parsed;
      } catch (err) {
        throw new ModelExtractorError(
          `model email-extractor call failed: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }

      if (!parsed) {
        throw new ModelExtractorError('model email-extractor returned no parsed output');
      }

      log.debug('model email-extractor returned', {
        household_id: context.householdId,
        email_id: email.emailId,
        episodes: parsed.episodes.length,
        facts: parsed.facts.length,
        suggestions: parsed.suggestions.length,
      });
      return parsed;
    },
  };
}
