/**
 * Unit tests for the model-backed event extractor.
 */

import { type HouseholdId } from '@homehub/shared';
import { type Logger, type ModelClient } from '@homehub/worker-runtime';
import { describe, expect, it, vi } from 'vitest';

import { ModelExtractorError } from './errors.js';
import { createKimiEventExtractor, type HouseholdContext } from './model-extractor.js';
import { type EventInput } from './types.js';

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

const EVENT: EventInput = {
  title: 'Dinner reservation',
  description: 'OpenTable',
  location: 'Giulia',
  startsAt: '2026-04-25T23:00:00.000Z',
  endsAt: '2026-04-26T01:00:00.000Z',
  allDay: false,
  attendees: [{ email: 'owner@example.com' }],
  ownerEmail: 'owner@example.com',
};

const CONTEXT: HouseholdContext = {
  householdId: HOUSEHOLD_ID,
  summary: 'Acme Household.',
  peopleRoster: [{ id: 'p1', name: 'Sarah', aliases: ['sarah@example.com'] }],
  placeRoster: [],
};

describe('createKimiEventExtractor', () => {
  it('returns episodes + facts on a valid model response', async () => {
    const generate = vi.fn(async () => ({
      text: '{...}',
      parsed: {
        episodes: [
          {
            occurred_at: '2026-04-25T23:00:00Z',
            title: 'Dinner',
            summary: 'Dinner at Giulia.',
            participants: ['person:Sarah'],
            mentions_facts: ['f_001'],
          },
        ],
        facts: [
          {
            id: 'f_001',
            subject: 'person:Sarah',
            predicate: 'is',
            object_value: 'vegetarian',
            confidence: 0.7,
            evidence: 'ordered the vegetarian dish',
            valid_from: 'inferred',
          },
        ],
      },
      model: 'moonshotai/kimi-k2',
      inputTokens: 300,
      outputTokens: 80,
      costUsd: 0.001,
      latencyMs: 200,
    }));
    const extractor = createKimiEventExtractor({
      modelClient: { generate } as unknown as ModelClient,
      log: makeLog(),
    });

    const result = await extractor.extract({ event: EVENT, context: CONTEXT });
    expect(result.episodes).toHaveLength(1);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.subject).toBe('person:Sarah');

    const callArgs = (generate.mock.calls as unknown as Array<Array<unknown>>)[0]![0] as {
      task: string;
      systemPrompt: string;
      userPrompt: string;
    };
    expect(callArgs.task).toBe('enrichment.event');
    expect(callArgs.systemPrompt).toMatch(/HomeHub enrichment model/);
    // People roster lives in the system prompt's household context.
    expect(callArgs.systemPrompt).toContain('person:Sarah');
    expect(callArgs.userPrompt).toContain(EVENT.title);
  });

  it('returns empty arrays when the model yields empty extraction', async () => {
    const generate = vi.fn(async () => ({
      text: '{...}',
      parsed: { episodes: [], facts: [] },
      model: 'moonshotai/kimi-k2',
      inputTokens: 50,
      outputTokens: 10,
      costUsd: 0,
      latencyMs: 40,
    }));
    const extractor = createKimiEventExtractor({
      modelClient: { generate } as unknown as ModelClient,
      log: makeLog(),
    });

    const result = await extractor.extract({ event: EVENT, context: CONTEXT });
    expect(result.episodes).toEqual([]);
    expect(result.facts).toEqual([]);
  });

  it('wraps generate() errors as ModelExtractorError', async () => {
    const generate = vi.fn(async () => {
      throw new Error('provider down');
    });
    const extractor = createKimiEventExtractor({
      modelClient: { generate } as unknown as ModelClient,
      log: makeLog(),
    });
    await expect(extractor.extract({ event: EVENT, context: CONTEXT })).rejects.toBeInstanceOf(
      ModelExtractorError,
    );
  });
});
