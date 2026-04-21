/**
 * Unit tests for the enrichment pipeline.
 *
 * We stub the model classifier, model extractor, deterministic
 * classifier, and a `withBudgetGuard`-compatible Supabase client. The
 * pipeline exercises three tiers: default, degraded, and budget-
 * exceeded, and the model-failure fallback path.
 */

import { type HouseholdId } from '@homehub/shared';
import { type Logger } from '@homehub/worker-runtime';
import { describe, expect, it, vi } from 'vitest';

import { ModelClassifierError, ModelExtractorError } from './errors.js';
import { type ModelEventClassifier } from './model-classifier.js';
import { type ModelEventExtractor, type HouseholdContext } from './model-extractor.js';
import { createEnrichmentPipeline, type EnrichmentPipeline } from './pipeline.js';
import { type EventClassification, type EventClassifier, type EventInput } from './types.js';

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

/**
 * Minimal Supabase fake that returns a given household row and an
 * arbitrary set of model_calls cost rows. Used to drive
 * `withBudgetGuard`'s decision.
 */
function makeSupabase(opts: { budgetCents?: number; totalCostUsd?: number }) {
  const householdRow = {
    settings: opts.budgetCents != null ? { model_budget_monthly_cents: opts.budgetCents } : {},
  };
  const rows = opts.totalCostUsd == null ? [] : [{ cost_usd: opts.totalCostUsd }];

  return {
    schema(name: string) {
      if (name !== 'app') throw new Error(`unexpected schema ${name}`);
      return {
        from(table: string) {
          if (table === 'household') {
            return {
              select() {
                return this;
              },
              eq(_c: string, _v: string) {
                return this;
              },
              async maybeSingle() {
                return { data: householdRow, error: null };
              },
            };
          }
          if (table === 'model_calls') {
            return {
              select() {
                return this;
              },
              eq(_c: string, _v: string) {
                return this;
              },
              gte(_c: string, _v: string) {
                return Promise.resolve({ data: rows, error: null });
              },
            };
          }
          throw new Error(`unexpected table ${table}`);
        },
      };
    },
  };
}

const HOUSEHOLD_ID = 'a0000000-0000-4000-8000-000000000001' as unknown as HouseholdId;

const EVENT: EventInput = {
  title: 'Dinner',
  description: '',
  location: '',
  startsAt: '2026-04-25T23:00:00.000Z',
  allDay: false,
  attendees: [],
  ownerEmail: 'owner@example.com',
};

const CONTEXT: HouseholdContext = {
  householdId: HOUSEHOLD_ID,
  peopleRoster: [],
  placeRoster: [],
};

const FOOD: EventClassification = {
  segment: 'food',
  kind: 'reservation',
  confidence: 0.9,
  rationale: 'model rationale',
  signals: ['model.v1'],
};

const DETERMINISTIC: EventClassification = {
  segment: 'system',
  kind: 'unknown',
  confidence: 0.2,
  rationale: 'deterministic rationale',
  signals: ['system.fallthrough'],
};

function makeDeterministic(): EventClassifier {
  return { classify: vi.fn(() => DETERMINISTIC) };
}

function makeModelClassifier(result: EventClassification | Error): ModelEventClassifier {
  return {
    classify: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  } as unknown as ModelEventClassifier;
}

function makeModelExtractor(
  result: Awaited<ReturnType<ModelEventExtractor['extract']>> | Error,
): ModelEventExtractor {
  return {
    extract: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  } as unknown as ModelEventExtractor;
}

function build(opts: {
  budgetCents?: number;
  totalCostUsd?: number;
  modelClassifier?: ModelEventClassifier;
  modelExtractor?: ModelEventExtractor;
  deterministicClassifier?: EventClassifier;
}): EnrichmentPipeline {
  const supabase = makeSupabase({
    ...(opts.budgetCents !== undefined ? { budgetCents: opts.budgetCents } : {}),
    ...(opts.totalCostUsd !== undefined ? { totalCostUsd: opts.totalCostUsd } : {}),
  });
  return createEnrichmentPipeline({
    modelClassifier: opts.modelClassifier ?? makeModelClassifier(FOOD),
    modelExtractor: opts.modelExtractor ?? makeModelExtractor({ episodes: [], facts: [] }),
    deterministicClassifier: opts.deterministicClassifier ?? makeDeterministic(),
    supabase: supabase as never,
    log: makeLog(),
  });
}

describe('EnrichmentPipeline.classify', () => {
  it('uses the model on the default tier', async () => {
    const model = makeModelClassifier(FOOD);
    const pipeline = build({ modelClassifier: model });
    const outcome = await pipeline.classify({ event: EVENT, householdId: HOUSEHOLD_ID });
    expect(outcome.source).toBe('model');
    expect(outcome.classification).toEqual(FOOD);
  });

  it('falls back to deterministic when the model throws', async () => {
    const model = makeModelClassifier(new ModelClassifierError('boom'));
    const det = makeDeterministic();
    const pipeline = build({ modelClassifier: model, deterministicClassifier: det });
    const outcome = await pipeline.classify({ event: EVENT, householdId: HOUSEHOLD_ID });
    expect(outcome.source).toBe('deterministic');
    expect(outcome.classification).toEqual(DETERMINISTIC);
    expect(det.classify).toHaveBeenCalledTimes(1);
  });

  it('falls back to deterministic when the budget is exceeded (no model call)', async () => {
    const model = makeModelClassifier(FOOD);
    const det = makeDeterministic();
    const pipeline = build({
      budgetCents: 100,
      totalCostUsd: 2.0, // $2 = 200 cents, over the 100-cent budget
      modelClassifier: model,
      deterministicClassifier: det,
    });
    const outcome = await pipeline.classify({ event: EVENT, householdId: HOUSEHOLD_ID });
    expect(outcome.source).toBe('deterministic');
    expect(model.classify).not.toHaveBeenCalled();
    expect(det.classify).toHaveBeenCalledTimes(1);
  });
});

describe('EnrichmentPipeline.extract', () => {
  it('runs the model extractor on the default tier', async () => {
    const extractor = makeModelExtractor({
      episodes: [
        {
          occurred_at: '2026-04-25T23:00:00Z',
          title: 'Dinner',
          summary: 's',
          participants: [],
          mentions_facts: [],
        },
      ],
      facts: [],
    });
    const pipeline = build({ modelExtractor: extractor });
    const outcome = await pipeline.extract({ event: EVENT, context: CONTEXT });
    expect(outcome.ran).toBe(true);
    expect(outcome.reason).toBe('ok');
    expect(outcome.extraction.episodes).toHaveLength(1);
  });

  it('skips extraction on the degraded tier unless allowExtraction is true', async () => {
    const extractor = makeModelExtractor({ episodes: [], facts: [] });
    const pipeline = build({
      budgetCents: 100,
      totalCostUsd: 0.85, // 85 cents = 85% of budget → degraded
      modelExtractor: extractor,
    });
    const outcome = await pipeline.extract({ event: EVENT, context: CONTEXT });
    expect(outcome.ran).toBe(false);
    expect(outcome.reason).toBe('degraded_skipped');
    expect(extractor.extract).not.toHaveBeenCalled();
  });

  it('skips extraction entirely when budget is exceeded', async () => {
    const extractor = makeModelExtractor({ episodes: [], facts: [] });
    const pipeline = build({
      budgetCents: 100,
      totalCostUsd: 2.0,
      modelExtractor: extractor,
    });
    const outcome = await pipeline.extract({ event: EVENT, context: CONTEXT });
    expect(outcome.ran).toBe(false);
    expect(outcome.reason).toBe('budget_exceeded');
    expect(extractor.extract).not.toHaveBeenCalled();
  });

  it('returns empty extraction + model_error reason when the extractor throws', async () => {
    const extractor = makeModelExtractor(new ModelExtractorError('boom'));
    const pipeline = build({ modelExtractor: extractor });
    const outcome = await pipeline.extract({ event: EVENT, context: CONTEXT });
    expect(outcome.ran).toBe(false);
    expect(outcome.reason).toBe('model_error');
    expect(outcome.extraction).toEqual({ episodes: [], facts: [] });
  });
});
