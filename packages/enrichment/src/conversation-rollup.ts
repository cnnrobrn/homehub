/**
 * Conversation rollup worker primitive (M3.5).
 *
 * Summarizes a substantive conversation window into a single
 * `mem.episode`. The episode's `source_type='conversation'` and
 * `source_id = conversation_id`; participants are resolved against the
 * household's person nodes.
 *
 * This module exposes the pure rollup builder. The enrichment worker's
 * `rollup_conversation` queue handler composes this with node
 * resolution + the actual episode insert; the builder here owns only
 * the prompt + model call + schema validation.
 *
 * Spec: `specs/04-memory-network/consolidation.md` (episodes as
 * consolidation target) + `specs/13-conversation/agent-loop.md`
 * (conversation→episode in Stage 6).
 */

import {
  conversationRollupSchema,
  loadPrompt,
  renderPrompt,
  type ConversationRollupResponse,
} from '@homehub/prompts';
import { type HouseholdId } from '@homehub/shared';
import { type Logger, type ModelClient } from '@homehub/worker-runtime';

import { type KnownPerson } from './conversation-extractor.js';
import { ModelExtractorError } from './errors.js';

/** Version tag stamped on `mem.episode.metadata.version`. */
export const CONVERSATION_ROLLUP_PROMPT_VERSION = '2026-04-20-conversation-rollup-v1';

/** Minimum turn count + word count for a conversation to be "substantive." */
export const ROLLUP_MIN_TURNS = 4;
export const ROLLUP_MIN_WORDS = 120;

/**
 * Turn excerpt for the rollup prompt. Unlike the extraction tail, the
 * rollup input INCLUDES the assistant turns — the episode summary
 * should capture both sides of the exchange.
 */
export interface RollupTurn {
  id: string;
  role: 'member' | 'assistant';
  body: string;
  createdAt: string;
  authorDisplay?: string;
}

export interface ConversationRollupInput {
  conversationId: string;
  householdId: HouseholdId;
  householdContext?: string;
  knownPeople: KnownPerson[];
  /** Chronologically-ordered turns covering the window to roll up. */
  turns: RollupTurn[];
}

export type ConversationRollupResult = ConversationRollupResponse;

export interface ConversationRollup {
  build(input: ConversationRollupInput): Promise<ConversationRollupResult>;
}

export interface CreateConversationRollupOptions {
  modelClient: ModelClient;
  log: Logger;
}

function formatKnownPeople(people: KnownPerson[]): string {
  if (people.length === 0) return '(no known people)';
  return people.map((p) => `- person:${p.name}`).join('\n');
}

function formatExcerpt(turns: RollupTurn[]): string {
  if (turns.length === 0) return '(empty)';
  return turns
    .map((t) => {
      const who =
        t.role === 'member'
          ? `member${t.authorDisplay ? ` (${t.authorDisplay})` : ''}`
          : 'assistant';
      return `${who}: ${t.body}`;
    })
    .join('\n');
}

function formatTimeWindow(turns: RollupTurn[]): string {
  if (turns.length === 0) return '(empty)';
  const first = turns[0]!.createdAt;
  const last = turns[turns.length - 1]!.createdAt;
  return `${first} — ${last}`;
}

/**
 * Cheap heuristic used by the worker to decide whether to run the
 * rollup at all. Substantive = ≥ ROLLUP_MIN_TURNS turns AND
 * ≥ ROLLUP_MIN_WORDS total words across all turns.
 */
export function isConversationSubstantive(turns: RollupTurn[]): boolean {
  if (turns.length < ROLLUP_MIN_TURNS) return false;
  const totalWords = turns.reduce((acc, t) => acc + countWords(t.body), 0);
  return totalWords >= ROLLUP_MIN_WORDS;
}

function countWords(body: string): number {
  if (!body) return 0;
  return body.trim().split(/\s+/).filter(Boolean).length;
}

export function createConversationRollup(
  opts: CreateConversationRollupOptions,
): ConversationRollup {
  const { modelClient, log } = opts;

  return {
    async build(input) {
      let prompt;
      try {
        prompt = loadPrompt('rollup/conversation');
      } catch (err) {
        throw new ModelExtractorError(
          `failed to load conversation rollup prompt: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }

      let rendered;
      try {
        rendered = renderPrompt(prompt, {
          household_context: input.householdContext ?? '(none supplied)',
          known_people: formatKnownPeople(input.knownPeople),
          conversation_excerpt: formatExcerpt(input.turns),
          time_window: formatTimeWindow(input.turns),
        });
      } catch (err) {
        throw new ModelExtractorError(
          `failed to render conversation rollup prompt: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }

      let parsed: ConversationRollupResult | undefined;
      try {
        const result = await modelClient.generate({
          task: 'rollup.conversation',
          household_id: input.householdId,
          systemPrompt: rendered.systemPrompt,
          userPrompt: rendered.userPrompt,
          schema: conversationRollupSchema,
          temperature: 0.3,
          maxOutputTokens: 500,
          cache: 'auto',
        });
        parsed = result.parsed;
      } catch (err) {
        throw new ModelExtractorError(
          `model conversation-rollup call failed: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }

      if (!parsed) {
        throw new ModelExtractorError('model conversation-rollup returned no parsed output');
      }

      log.debug('model conversation-rollup returned', {
        household_id: input.householdId,
        conversation_id: input.conversationId,
        participants: parsed.participants.length,
      });
      return parsed;
    },
  };
}
