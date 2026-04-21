/**
 * Unit tests for the conversation rollup primitive (M3.5).
 */

import { type HouseholdId } from '@homehub/shared';
import { type Logger, type ModelClient } from '@homehub/worker-runtime';
import { describe, expect, it, vi } from 'vitest';

import {
  createConversationRollup,
  isConversationSubstantive,
  ROLLUP_MIN_TURNS,
  ROLLUP_MIN_WORDS,
  type ConversationRollupInput,
  type RollupTurn,
} from './conversation-rollup.js';
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

function makeTurns(n: number, words: number): RollupTurn[] {
  const out: RollupTurn[] = [];
  const body = Array(words).fill('word').join(' ');
  for (let i = 0; i < n; i += 1) {
    out.push({
      id: `turn-${i}`,
      role: i % 2 === 0 ? 'member' : 'assistant',
      body,
      createdAt: new Date(Date.UTC(2026, 3, 20, 12, i, 0)).toISOString(),
    });
  }
  return out;
}

describe('isConversationSubstantive', () => {
  it('rejects too-few-turn conversations', () => {
    const turns = makeTurns(ROLLUP_MIN_TURNS - 1, 200);
    expect(isConversationSubstantive(turns)).toBe(false);
  });

  it('rejects too-short word count', () => {
    const turns = makeTurns(ROLLUP_MIN_TURNS, 10);
    expect(isConversationSubstantive(turns)).toBe(false);
  });

  it('accepts conversations meeting both thresholds', () => {
    const turns = makeTurns(ROLLUP_MIN_TURNS, Math.ceil(ROLLUP_MIN_WORDS / ROLLUP_MIN_TURNS) + 2);
    expect(isConversationSubstantive(turns)).toBe(true);
  });
});

const BASE_INPUT: ConversationRollupInput = {
  conversationId: 'c1',
  householdId: HOUSEHOLD_ID,
  householdContext: 'Acme household.',
  knownPeople: [{ id: 'sarah-id', name: 'Sarah' }],
  turns: [
    {
      id: 't1',
      role: 'member',
      body: 'plan dinner tonight, something quick and vegetarian',
      createdAt: '2026-04-20T18:30:00Z',
      authorDisplay: 'Owner',
    },
    {
      id: 't2',
      role: 'assistant',
      body: 'Pantry has paneer, rice, spinach — chickpea-paneer curry, ~30 min. Want me to pencil it in?',
      createdAt: '2026-04-20T18:31:00Z',
    },
    {
      id: 't3',
      role: 'member',
      body: 'yes',
      createdAt: '2026-04-20T18:32:15Z',
      authorDisplay: 'Owner',
    },
  ],
};

describe('createConversationRollup', () => {
  it('builds an episode from a valid model response', async () => {
    const generate = vi.fn(async () => ({
      text: '{...}',
      parsed: {
        title: 'Dinner planning: vegetarian with paneer',
        summary:
          'Member asked for a quick vegetarian dinner; assistant suggested chickpea-paneer curry using pantry items and member accepted.',
        participants: ['person:Sarah'],
        occurred_at: '2026-04-20T18:30:00Z',
        ended_at: '2026-04-20T18:32:15Z',
      },
      model: 'moonshotai/kimi-k2',
      inputTokens: 500,
      outputTokens: 80,
      costUsd: 0.001,
      latencyMs: 250,
    }));
    const rollup = createConversationRollup({
      modelClient: { generate } as unknown as ModelClient,
      log: makeLog(),
    });

    const result = await rollup.build(BASE_INPUT);
    expect(result.title).toMatch(/Dinner planning/);
    expect(result.participants).toEqual(['person:Sarah']);

    const callArgs = (generate.mock.calls as unknown as Array<Array<unknown>>)[0]![0] as {
      task: string;
      systemPrompt: string;
      userPrompt: string;
    };
    expect(callArgs.task).toBe('rollup.conversation');
    expect(callArgs.userPrompt).toContain('chickpea-paneer curry');
  });

  it('wraps generate() errors as ModelExtractorError', async () => {
    const generate = vi.fn(async () => {
      throw new Error('provider down');
    });
    const rollup = createConversationRollup({
      modelClient: { generate } as unknown as ModelClient,
      log: makeLog(),
    });
    await expect(rollup.build(BASE_INPUT)).rejects.toBeInstanceOf(ModelExtractorError);
  });
});
