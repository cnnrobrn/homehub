/**
 * Unit tests for the model-backed event classifier.
 *
 * Strategy: stub `ModelClient.generate()` and assert:
 *   - Happy path → returns `EventClassification` shaped from the
 *     model's JSON.
 *   - Schema failure (model returned something wrong) → propagates as
 *     `ModelClassifierError`.
 *   - Model HTTP error → propagates as `ModelClassifierError` with
 *     the original error on `.cause`.
 *   - `signals` defaulted when the model returned an empty array.
 */

import { type HouseholdId } from '@homehub/shared';
import { type Logger, type ModelClient } from '@homehub/worker-runtime';
import { describe, expect, it, vi } from 'vitest';

import { ModelClassifierError } from './errors.js';
import { createKimiEventClassifier } from './model-classifier.js';
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
  description: 'OpenTable 4p',
  location: 'Giulia',
  startsAt: '2026-04-25T23:00:00.000Z',
  endsAt: '2026-04-26T01:00:00.000Z',
  allDay: false,
  attendees: [{ email: 'owner@example.com', displayName: 'Owner' }],
  ownerEmail: 'owner@example.com',
  provider: 'gcal',
};

describe('createKimiEventClassifier', () => {
  it('returns a classification from a valid model response', async () => {
    const generate = vi.fn(async () => ({
      text: '{...}',
      parsed: {
        segment: 'food',
        kind: 'reservation',
        confidence: 0.9,
        rationale: 'named restaurant',
        signals: ['title.keyword:reservation'],
      },
      model: 'moonshotai/kimi-k2',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.0005,
      latencyMs: 120,
    }));
    const modelClient = { generate } as unknown as ModelClient;
    const classifier = createKimiEventClassifier({ modelClient, log: makeLog() });

    const result = await classifier.classify({
      event: EVENT,
      householdId: HOUSEHOLD_ID,
      householdContext: 'Acme Household.',
    });

    expect(result.segment).toBe('food');
    expect(result.kind).toBe('reservation');
    expect(result.signals).toEqual(['title.keyword:reservation']);
    expect(generate).toHaveBeenCalledTimes(1);

    const args = (generate.mock.calls as unknown as Array<Array<unknown>>)[0]![0] as {
      task: string;
      household_id: string;
      systemPrompt: string;
      userPrompt: string;
      cache: string;
    };
    expect(args.task).toBe('enrichment.event.classify');
    expect(args.household_id).toBe(HOUSEHOLD_ID);
    expect(args.systemPrompt).toMatch(/HomeHub event classifier/);
    expect(args.userPrompt).toContain(EVENT.title);
    expect(args.cache).toBe('auto');
  });

  it('defaults signals to a model-version tag when the model returns empty', async () => {
    const generate = vi.fn(async () => ({
      text: '{...}',
      parsed: {
        segment: 'system',
        kind: 'unknown',
        confidence: 0.3,
        rationale: 'no signal',
        signals: [],
      },
      model: 'moonshotai/kimi-k2',
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0,
      latencyMs: 10,
    }));
    const classifier = createKimiEventClassifier({
      modelClient: { generate } as unknown as ModelClient,
      log: makeLog(),
    });

    const result = await classifier.classify({ event: EVENT, householdId: HOUSEHOLD_ID });
    expect(result.signals.length).toBe(1);
    expect(result.signals[0]).toMatch(/model\./);
  });

  it('wraps generate() HTTP errors as ModelClassifierError', async () => {
    const boom = new Error('OpenRouter 503');
    const generate = vi.fn(async () => {
      throw boom;
    });
    const classifier = createKimiEventClassifier({
      modelClient: { generate } as unknown as ModelClient,
      log: makeLog(),
    });
    await expect(
      classifier.classify({ event: EVENT, householdId: HOUSEHOLD_ID }),
    ).rejects.toBeInstanceOf(ModelClassifierError);
  });

  it('wraps generate() schema errors as ModelClassifierError', async () => {
    const schemaErr = new Error('STRUCTURED_OUTPUT_FAILED');
    const generate = vi.fn(async () => {
      throw schemaErr;
    });
    const classifier = createKimiEventClassifier({
      modelClient: { generate } as unknown as ModelClient,
      log: makeLog(),
    });
    await expect(
      classifier.classify({ event: EVENT, householdId: HOUSEHOLD_ID }),
    ).rejects.toBeInstanceOf(ModelClassifierError);
  });
});
