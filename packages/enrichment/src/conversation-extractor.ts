/**
 * Model-backed conversation extractor (M3.5).
 *
 * Wraps `ModelClient.generate()` against the `extraction/conversation`
 * prompt. Emits atomic, member-stated facts plus optional member-
 * authored rules. Unlike the event extractor, this path does NOT emit
 * episodes — the rollup path (`rollup/conversation`) is responsible for
 * episode construction.
 *
 * Spec: `specs/04-memory-network/extraction.md` (atomicity),
 * `specs/13-conversation/agent-loop.md` (Stage 6 post-turn writes),
 * `specs/13-conversation/overview.md` (whisper-mode — the extractor is
 * indifferent; the worker enforces by skipping the extraction call
 * altogether for `no_memory_write=true` turns).
 *
 * Error contract: failures surface as `ModelExtractorError`. The
 * enrichment worker's dispatch catches the error and routes the
 * message to the DLQ; there is no deterministic fallback here because
 * the conversation extractor has no hand-written rule set to fall back
 * to.
 */

import {
  conversationExtractionSchema,
  loadPrompt,
  renderPrompt,
  type ConversationExtractionResponse,
} from '@homehub/prompts';
import { type HouseholdId } from '@homehub/shared';
import { type Logger, type ModelClient } from '@homehub/worker-runtime';

import { ModelExtractorError } from './errors.js';

/** Version tag stamped on `mem.fact_candidate.evidence[].prompt_version`. */
export const CONVERSATION_EXTRACTOR_PROMPT_VERSION = '2026-04-20-conversation-v1';

/**
 * Member-sourced confidence ceiling applied to the extractor's reported
 * confidence. Even when the model is 0.99 sure, a conversation-sourced
 * fact tops out at 0.85 so the reconciler's own promotion policy (which
 * factors in source provenance) stays in control.
 */
export const MEMBER_SOURCED_CONFIDENCE_CEILING = 0.85;

/**
 * Known-people roster entry. Canonical names from `mem.node` `type='person'`
 * in the household. The extractor matches them case-insensitively.
 */
export interface KnownPerson {
  id: string;
  name: string;
  aliases?: string[];
}

/**
 * One turn in the conversation tail supplied as context.
 *
 * `role` is 'member' or 'assistant'; the tail excludes system/tool
 * turns. `body` is the raw markdown text (trimmed).
 */
export interface ConversationTailTurn {
  id: string;
  role: 'member' | 'assistant';
  body: string;
  createdAt: string;
  authorDisplay?: string;
}

export interface ConversationExtractorInput {
  /**
   * The member turn to extract from. `body` is the actual text; the
   * extractor does not read tail context for extraction — that's
   * context-only to disambiguate node references.
   */
  turn: {
    id: string;
    body: string;
    authorDisplay?: string;
    createdAt: string;
  };
  /** Up to ~3 prior turns (excluding the member turn). Context only. */
  tail: ConversationTailTurn[];
  householdId: HouseholdId;
  householdContext?: string;
  knownPeople: KnownPerson[];
}

export type ConversationExtractionResult = ConversationExtractionResponse;

export interface ConversationExtractor {
  extract(input: ConversationExtractorInput): Promise<ConversationExtractionResult>;
}

export interface CreateConversationExtractorOptions {
  modelClient: ModelClient;
  log: Logger;
}

function formatKnownPeople(people: KnownPerson[]): string {
  if (people.length === 0) return '(no known people)';
  return people
    .map((p) => {
      const aliases = p.aliases && p.aliases.length > 0 ? ` (aka ${p.aliases.join(', ')})` : '';
      return `- person:${p.name}${aliases}`;
    })
    .join('\n');
}

function formatTail(tail: ConversationTailTurn[]): string {
  if (tail.length === 0) return '(no prior turns)';
  return tail
    .map((t) => {
      const who =
        t.role === 'member'
          ? `member${t.authorDisplay ? ` (${t.authorDisplay})` : ''}`
          : 'assistant';
      return `${who}: ${t.body}`;
    })
    .join('\n');
}

export function createConversationExtractor(
  opts: CreateConversationExtractorOptions,
): ConversationExtractor {
  const { modelClient, log } = opts;

  return {
    async extract(input) {
      let prompt;
      try {
        prompt = loadPrompt('conversation');
      } catch (err) {
        throw new ModelExtractorError(
          `failed to load conversation prompt: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }

      let rendered;
      try {
        rendered = renderPrompt(prompt, {
          household_context: input.householdContext ?? '(none supplied)',
          known_people: formatKnownPeople(input.knownPeople),
          conversation_tail: formatTail(input.tail),
          message_body: input.turn.body,
        });
      } catch (err) {
        throw new ModelExtractorError(
          `failed to render conversation prompt: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }

      let parsed: ConversationExtractionResult | undefined;
      try {
        const result = await modelClient.generate({
          task: 'enrichment.conversation',
          household_id: input.householdId,
          systemPrompt: rendered.systemPrompt,
          userPrompt: rendered.userPrompt,
          schema: conversationExtractionSchema,
          temperature: 0.2,
          maxOutputTokens: 500,
          cache: 'auto',
        });
        parsed = result.parsed;
      } catch (err) {
        throw new ModelExtractorError(
          `model conversation-extractor call failed: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }

      if (!parsed) {
        throw new ModelExtractorError('model conversation-extractor returned no parsed output');
      }

      // Clamp every fact's confidence at the member-sourced ceiling.
      // Mutating the parsed object is safe — we own it from here.
      for (const fact of parsed.facts) {
        if (fact.confidence > MEMBER_SOURCED_CONFIDENCE_CEILING) {
          fact.confidence = MEMBER_SOURCED_CONFIDENCE_CEILING;
        }
      }

      log.debug('model conversation-extractor returned', {
        household_id: input.householdId,
        facts: parsed.facts.length,
        rules: parsed.rules.length,
      });
      return parsed;
    },
  };
}
