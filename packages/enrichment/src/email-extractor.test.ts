/**
 * Unit tests for the model-backed email extractor (M4-B).
 */

import { type HouseholdId } from '@homehub/shared';
import { type Logger, type ModelClient } from '@homehub/worker-runtime';
import { describe, expect, it, vi } from 'vitest';

import {
  createKimiEmailExtractor,
  EMAIL_BODY_TRUNCATE_BYTES,
  EMAIL_EXTRACTOR_PROMPT_VERSION,
  type EmailInput,
  type EmailHouseholdContext,
} from './email-extractor.js';
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

const BASE_CONTEXT: EmailHouseholdContext = {
  householdId: HOUSEHOLD_ID,
  summary: 'Acme household; 2 adults.',
  peopleRoster: [{ id: 'owner-id', name: 'Alice' }],
  placeRoster: [{ id: 'giulia-id', name: "Giulia's" }],
  merchantRoster: [{ id: 'eversource-id', name: 'Eversource' }],
};

const RESERVATION_INPUT: EmailInput = {
  emailId: '00000000-0000-4000-8000-000000000101',
  subject: "You're confirmed — Dinner at Giulia's",
  fromEmail: 'noreply@opentable.com',
  fromName: 'OpenTable',
  receivedAt: '2026-04-21T18:04:00Z',
  categories: ['reservation'],
  body: "Your reservation at Giulia's for 4 is confirmed for Saturday, April 25 at 7:00 PM.",
};

describe('EMAIL_EXTRACTOR_PROMPT_VERSION', () => {
  it('exports a stable tag callers can stamp on evidence rows', () => {
    expect(EMAIL_EXTRACTOR_PROMPT_VERSION).toBe('2026-04-20-email-v1');
  });
});

describe('createKimiEmailExtractor', () => {
  it('returns episodes + facts + suggestions from a reservation email', async () => {
    const generate = vi.fn(async () => ({
      text: '{...}',
      parsed: {
        episodes: [
          {
            kind: 'reservation',
            occurred_at: '2026-04-25T23:00:00Z',
            title: "Dinner at Giulia's",
            summary: "OpenTable reservation at Giulia's for 4.",
            subject_reference: "place:Giulia's",
            attributes: {
              venue: "Giulia's",
              party_size: 4,
              reservation_id: '9A7B',
            },
          },
        ],
        facts: [
          {
            id: 'f_001',
            subject: "place:Giulia's",
            predicate: 'located_in',
            object_value: 'Cambridge MA',
            confidence: 0.9,
            evidence: '1372 Cambridge St, Cambridge MA.',
            valid_from: 'inferred',
          },
        ],
        suggestions: [
          {
            kind: 'add_to_calendar',
            title: "Dinner at Giulia's",
            starts_at: '2026-04-25T23:00:00Z',
            location: "Giulia's, 1372 Cambridge St",
            attendees: [],
            rationale: 'OpenTable confirmed a reservation on Saturday; mirroring to the calendar.',
            confidence: 0.85,
          },
        ],
      },
      model: 'moonshotai/kimi-k2',
      inputTokens: 800,
      outputTokens: 300,
      costUsd: 0.002,
      latencyMs: 350,
    }));
    const extractor = createKimiEmailExtractor({
      modelClient: { generate } as unknown as ModelClient,
      log: makeLog(),
    });

    const result = await extractor.extract({ email: RESERVATION_INPUT, context: BASE_CONTEXT });
    expect(result.episodes).toHaveLength(1);
    expect(result.facts).toHaveLength(1);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.kind).toBe('add_to_calendar');

    const callArgs = (generate.mock.calls as unknown as Array<Array<unknown>>)[0]![0] as {
      task: string;
      systemPrompt: string;
      userPrompt: string;
      maxOutputTokens: number;
      temperature: number;
    };
    expect(callArgs.task).toBe('enrichment.email');
    expect(callArgs.maxOutputTokens).toBe(1500);
    expect(callArgs.temperature).toBe(0.15);
    // Known rosters flow into the system prompt.
    expect(callArgs.systemPrompt).toContain("place:Giulia's");
    expect(callArgs.systemPrompt).toContain('merchant:Eversource');
    // Email fields flow into the user prompt.
    expect(callArgs.userPrompt).toContain("Dinner at Giulia's");
    expect(callArgs.userPrompt).toContain('noreply@opentable.com');
  });

  it('returns empty arrays for an unrecognizable email', async () => {
    const generate = vi.fn(async () => ({
      text: '{...}',
      parsed: { episodes: [], facts: [], suggestions: [] },
      model: 'moonshotai/kimi-k2',
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0,
      latencyMs: 50,
    }));
    const extractor = createKimiEmailExtractor({
      modelClient: { generate } as unknown as ModelClient,
      log: makeLog(),
    });
    const result = await extractor.extract({
      email: {
        ...RESERVATION_INPUT,
        subject: 'Weekly newsletter',
        categories: [],
        body: "Here are this week's articles.",
      },
      context: BASE_CONTEXT,
    });
    expect(result.episodes).toEqual([]);
    expect(result.facts).toEqual([]);
    expect(result.suggestions).toEqual([]);
  });

  it('wraps generate() errors as ModelExtractorError', async () => {
    const generate = vi.fn(async () => {
      throw new Error('openrouter down');
    });
    const extractor = createKimiEmailExtractor({
      modelClient: { generate } as unknown as ModelClient,
      log: makeLog(),
    });
    await expect(
      extractor.extract({ email: RESERVATION_INPUT, context: BASE_CONTEXT }),
    ).rejects.toBeInstanceOf(ModelExtractorError);
  });

  it('throws ModelExtractorError when the model returns no parsed output', async () => {
    const generate = vi.fn(async () => ({
      text: 'not-json',
      parsed: undefined,
      model: 'moonshotai/kimi-k2',
      inputTokens: 10,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: 10,
    }));
    const extractor = createKimiEmailExtractor({
      modelClient: { generate } as unknown as ModelClient,
      log: makeLog(),
    });
    await expect(
      extractor.extract({ email: RESERVATION_INPUT, context: BASE_CONTEXT }),
    ).rejects.toBeInstanceOf(ModelExtractorError);
  });

  it('truncates oversized bodies before passing to the model', async () => {
    const generate = vi.fn(async () => ({
      text: '{...}',
      parsed: { episodes: [], facts: [], suggestions: [] },
      model: 'moonshotai/kimi-k2',
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
      latencyMs: 1,
    }));
    const extractor = createKimiEmailExtractor({
      modelClient: { generate } as unknown as ModelClient,
      log: makeLog(),
    });
    const giantBody = 'x'.repeat(EMAIL_BODY_TRUNCATE_BYTES + 4096);
    await extractor.extract({
      email: { ...RESERVATION_INPUT, body: giantBody },
      context: BASE_CONTEXT,
    });
    const callArgs = (generate.mock.calls as unknown as Array<Array<unknown>>)[0]![0] as {
      userPrompt: string;
    };
    // The prompt's embedded body must not include every 'x' — truncated
    // body fits inside the budget (allow some header slop).
    const bodyMarker = callArgs.userPrompt.indexOf('x'.repeat(100));
    expect(bodyMarker).toBeGreaterThan(-1);
    const bodyTail = callArgs.userPrompt.slice(bodyMarker);
    // Leaves room for the trailing fence + schema text, so cap at a
    // generous multiple of the truncate size.
    expect(bodyTail.length).toBeLessThan(EMAIL_BODY_TRUNCATE_BYTES + 2048);
  });
});
