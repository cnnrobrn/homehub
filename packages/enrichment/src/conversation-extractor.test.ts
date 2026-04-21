/**
 * Unit tests for the model-backed conversation extractor (M3.5).
 */

import { type HouseholdId } from '@homehub/shared';
import { type Logger, type ModelClient } from '@homehub/worker-runtime';
import { describe, expect, it, vi } from 'vitest';

import {
  createConversationExtractor,
  MEMBER_SOURCED_CONFIDENCE_CEILING,
  type ConversationExtractorInput,
} from './conversation-extractor.js';
import { ModelExtractorError } from './errors.js';

function makeLog(): Logger {
  const noop = () => {};
  const base = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => base,
  } as Logger;
  return base;
}

const HOUSEHOLD_ID = 'a0000000-0000-4000-8000-000000000001' as unknown as HouseholdId;

const BASE_INPUT: ConversationExtractorInput = {
  turn: {
    id: 't1',
    body: 'Sarah is vegetarian now.',
    authorDisplay: 'Owner',
    createdAt: '2026-04-20T12:00:00Z',
  },
  tail: [
    {
      id: 't0',
      role: 'assistant',
      body: 'What would you like for dinner?',
      createdAt: '2026-04-20T11:59:30Z',
    },
  ],
  householdId: HOUSEHOLD_ID,
  householdContext: 'Acme household.',
  knownPeople: [{ id: 'sarah-id', name: 'Sarah' }],
};

describe('createConversationExtractor', () => {
  it('returns facts + rules from a valid model response', async () => {
    const generate = vi.fn(async () => ({
      text: '{...}',
      parsed: {
        facts: [
          {
            id: 'f_001',
            subject: 'person:Sarah',
            predicate: 'is',
            object_value: 'vegetarian',
            confidence: 0.85,
            evidence: 'Sarah is vegetarian now.',
            valid_from: 'inferred',
          },
          {
            id: 'f_002',
            subject: 'person:Sarah',
            predicate: 'allergic_to',
            object_value: 'peanuts',
            confidence: 0.8,
            evidence: 'also peanut-allergic',
            valid_from: 'inferred',
          },
        ],
        rules: [
          {
            id: 'r_001',
            description: 'No restaurants on Tuesdays.',
            predicate_dsl: {
              kind: 'temporal_exclusion',
              category: 'restaurant',
              day_of_week: 'tuesday',
            },
          },
        ],
      },
      model: 'moonshotai/kimi-k2',
      inputTokens: 400,
      outputTokens: 150,
      costUsd: 0.001,
      latencyMs: 200,
    }));
    const extractor = createConversationExtractor({
      modelClient: { generate } as unknown as ModelClient,
      log: makeLog(),
    });

    const result = await extractor.extract(BASE_INPUT);
    expect(result.facts).toHaveLength(2);
    expect(result.rules).toHaveLength(1);

    const callArgs = (generate.mock.calls as unknown as Array<Array<unknown>>)[0]![0] as {
      task: string;
      systemPrompt: string;
      userPrompt: string;
      maxOutputTokens: number;
    };
    expect(callArgs.task).toBe('enrichment.conversation');
    expect(callArgs.maxOutputTokens).toBe(500);
    // Known-people roster must be rendered into the system prompt.
    expect(callArgs.systemPrompt).toContain('person:Sarah');
    // Message body goes into the user prompt.
    expect(callArgs.userPrompt).toContain('Sarah is vegetarian now.');
  });

  it('clamps model-reported confidence at the member-sourced ceiling', async () => {
    const generate = vi.fn(async () => ({
      text: '{...}',
      parsed: {
        facts: [
          {
            id: 'f_001',
            subject: 'person:Sarah',
            predicate: 'is',
            object_value: 'vegetarian',
            // Model mistakenly reports 0.99; the extractor must clamp.
            confidence: 0.99,
            evidence: 'Sarah is vegetarian now.',
            valid_from: 'inferred',
          },
        ],
        rules: [],
      },
      model: 'moonshotai/kimi-k2',
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
      latencyMs: 1,
    }));
    const extractor = createConversationExtractor({
      modelClient: { generate } as unknown as ModelClient,
      log: makeLog(),
    });

    const result = await extractor.extract(BASE_INPUT);
    expect(result.facts[0]?.confidence).toBe(MEMBER_SOURCED_CONFIDENCE_CEILING);
  });

  it('returns empty arrays when the message is a question', async () => {
    const generate = vi.fn(async () => ({
      text: '{...}',
      parsed: { facts: [], rules: [] },
      model: 'moonshotai/kimi-k2',
      inputTokens: 50,
      outputTokens: 10,
      costUsd: 0,
      latencyMs: 40,
    }));
    const extractor = createConversationExtractor({
      modelClient: { generate } as unknown as ModelClient,
      log: makeLog(),
    });

    const result = await extractor.extract({
      ...BASE_INPUT,
      turn: { ...BASE_INPUT.turn, body: "What's for dinner?" },
    });
    expect(result.facts).toEqual([]);
    expect(result.rules).toEqual([]);
  });

  it('wraps generate() errors as ModelExtractorError', async () => {
    const generate = vi.fn(async () => {
      throw new Error('provider down');
    });
    const extractor = createConversationExtractor({
      modelClient: { generate } as unknown as ModelClient,
      log: makeLog(),
    });
    await expect(extractor.extract(BASE_INPUT)).rejects.toBeInstanceOf(ModelExtractorError);
  });
});
