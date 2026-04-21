/**
 * Reflector handler unit tests.
 *
 * We drive `runReflector` end-to-end against a small in-memory fake
 * Supabase. The fake is deliberately coarse — enough to exercise the
 * load → gate → model → insert → audit chain. A richer fixture harness
 * can move into a shared package when the third caller shows up.
 */

import { type Database } from '@homehub/db';
import { type HouseholdId } from '@homehub/shared';
import {
  type BudgetCheckResult,
  type GenerateResult,
  type Logger,
  type ModelClient,
} from '@homehub/worker-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Namespace type alias drives `vi.importActual` typing without triggering
// `import/no-duplicates` on the runtime-shaped import above.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type WorkerRuntimeModule = typeof import('@homehub/worker-runtime');

type EpisodeRow = Database['mem']['Tables']['episode']['Row'];
type FactRow = Database['mem']['Tables']['fact']['Row'];
type FactCandidateRow = Database['mem']['Tables']['fact_candidate']['Row'];
type PatternRow = Database['mem']['Tables']['pattern']['Row'];
type InsightRow = Database['mem']['Tables']['insight']['Row'];
type AuditInsert = Database['audit']['Tables']['event']['Insert'];

const HID = '11111111-1111-4111-8111-111111111111' as HouseholdId;
const WEEK = '2026-04-13'; // Monday

// -----------------------------------------------------------------
// Budget guard mock
// -----------------------------------------------------------------
// `runReflector` imports `withBudgetGuard` from the runtime; we
// mock it per-test so tests can force the budget_exceeded path.
const budgetGuardMock = vi.fn<(...args: unknown[]) => Promise<BudgetCheckResult>>();

vi.mock('@homehub/worker-runtime', async () => {
  const actual = await vi.importActual<WorkerRuntimeModule>('@homehub/worker-runtime');
  return {
    ...actual,
    withBudgetGuard: (...args: unknown[]) => budgetGuardMock(...args),
  };
});

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

function makeEpisode(id: string, occurredAt: string, title = `Episode ${id}`): EpisodeRow {
  return {
    id,
    household_id: HID,
    occurred_at: occurredAt,
    ended_at: null,
    recorded_at: occurredAt,
    source_type: 'test',
    source_id: `src:${id}`,
    title,
    summary: `${title} summary`,
    participants: [],
    place_node_id: null,
    metadata: {},
    embedding: null,
  } as EpisodeRow;
}

function makeFact(id: string, recordedAt: string): FactRow {
  return {
    id,
    household_id: HID,
    subject_node_id: '22222222-2222-4222-8222-222222222222',
    predicate: 'likes',
    object_value: 'sushi',
    object_node_id: null,
    confidence: 0.9,
    evidence: [],
    conflict_status: 'none',
    last_reinforced_at: recordedAt,
    recorded_at: recordedAt,
    reinforcement_count: 1,
    source: 'extraction',
    superseded_at: null,
    superseded_by: null,
    valid_from: recordedAt,
    valid_to: null,
  } as FactRow;
}

function makeCandidate(id: string, recordedAt: string): FactCandidateRow {
  return {
    id,
    household_id: HID,
    subject_node_id: '22222222-2222-4222-8222-222222222222',
    predicate: 'likes',
    object_value: 'ramen',
    object_node_id: null,
    confidence: 0.7,
    evidence: [],
    promoted_fact_id: null,
    reason: null,
    recorded_at: recordedAt,
    source: 'extraction',
    status: 'pending',
    valid_from: recordedAt,
    valid_to: null,
  } as FactCandidateRow;
}

function makePattern(id: string, lastReinforced: string): PatternRow {
  return {
    id,
    household_id: HID,
    kind: 'temporal',
    description: `Pattern ${id}`,
    sample_size: 5,
    confidence: 0.7,
    last_reinforced_at: lastReinforced,
    observed_from: lastReinforced,
    observed_to: lastReinforced,
    parameters: {},
    status: 'active',
  } as PatternRow;
}

/**
 * Fake Supabase builder. The API surface is tailored to the queries
 * `runReflector` runs:
 *   - app.household.select('id')               -> household ids
 *   - mem.insight.select('id').eq.eq.maybeSingle() -> existing insight
 *   - mem.insight.insert().select('id').single() -> created insight
 *   - mem.episode.select.eq.gte.lt.order.limit -> episodes
 *   - mem.fact_candidate.select.eq.gte.lt      -> candidates
 *   - mem.fact.select.eq.gte.lt                -> canonical facts
 *   - mem.pattern.select.eq.or                 -> active patterns
 *   - audit.event.insert                       -> audit row
 */
function fakeSupabase(opts: {
  householdIds?: string[];
  existingInsight?: Pick<InsightRow, 'id'> | null;
  episodes?: EpisodeRow[];
  candidates?: FactCandidateRow[];
  facts?: FactRow[];
  patterns?: PatternRow[];
}): {
  client: unknown;
  insertedInsights: Array<{ household_id: string; week_start: string; body_md: string }>;
  insertedAuditEvents: AuditInsert[];
} {
  const insertedInsights: Array<{
    household_id: string;
    week_start: string;
    body_md: string;
  }> = [];
  const insertedAuditEvents: AuditInsert[] = [];
  const households = (opts.householdIds ?? [HID]).map((id) => ({ id }));

  const client = {
    schema(schemaName: string) {
      return {
        from(table: string) {
          if (schemaName === 'app' && table === 'household') {
            return { select: () => Promise.resolve({ data: households, error: null }) };
          }
          if (schemaName === 'mem' && table === 'insight') {
            return {
              select: (_cols: string) => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: opts.existingInsight ?? null,
                        error: null,
                      }),
                  }),
                }),
              }),
              insert: (row: { household_id: string; week_start: string; body_md: string }) => ({
                select: () => ({
                  single: () => {
                    const id = `insight_${insertedInsights.length + 1}`;
                    insertedInsights.push(row);
                    return Promise.resolve({ data: { id }, error: null });
                  },
                }),
              }),
            };
          }
          if (schemaName === 'mem' && table === 'episode') {
            return {
              select: () => ({
                eq: () => ({
                  gte: () => ({
                    lt: () => ({
                      order: () => ({
                        limit: () => Promise.resolve({ data: opts.episodes ?? [], error: null }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (schemaName === 'mem' && table === 'fact_candidate') {
            return {
              select: () => ({
                eq: () => ({
                  gte: () => ({
                    lt: () => Promise.resolve({ data: opts.candidates ?? [], error: null }),
                  }),
                }),
              }),
            };
          }
          if (schemaName === 'mem' && table === 'fact') {
            return {
              select: () => ({
                eq: () => ({
                  gte: () => ({
                    lt: () => Promise.resolve({ data: opts.facts ?? [], error: null }),
                  }),
                }),
              }),
            };
          }
          if (schemaName === 'mem' && table === 'pattern') {
            return {
              select: () => ({
                eq: () => ({
                  or: () => Promise.resolve({ data: opts.patterns ?? [], error: null }),
                }),
              }),
            };
          }
          if (schemaName === 'audit' && table === 'event') {
            return {
              insert: (row: AuditInsert) => {
                insertedAuditEvents.push(row);
                return Promise.resolve({ error: null });
              },
            };
          }
          throw new Error(`fakeSupabase: unknown ${schemaName}.${table}`);
        },
      };
    },
  };

  return { client, insertedInsights, insertedAuditEvents };
}

function silentLogger(): Logger {
  const noop = (): void => undefined;
  const self: Logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => self,
  };
  return self;
}

type GenerateFn = (args: unknown) => Promise<GenerateResult<unknown>>;

function fakeModelClient(generate: GenerateFn): ModelClient {
  return {
    generate: generate as unknown as ModelClient['generate'],
    embed: async () => {
      throw new Error('embed not used in reflector tests');
    },
  };
}

// -----------------------------------------------------------------
// Tests
// -----------------------------------------------------------------

describe('runReflector', () => {
  beforeEach(() => {
    budgetGuardMock.mockReset();
  });

  it('writes an insight + audit event on the happy path', async () => {
    budgetGuardMock.mockResolvedValue({ ok: true, tier: 'default' });

    const episodes = [
      makeEpisode('e1', '2026-04-13T09:00:00.000Z'),
      makeEpisode('e2', '2026-04-14T09:00:00.000Z'),
      makeEpisode('e3', '2026-04-15T09:00:00.000Z'),
      makeEpisode('e4', '2026-04-16T09:00:00.000Z'),
      makeEpisode('e5', '2026-04-17T09:00:00.000Z'),
      makeEpisode('e6', '2026-04-18T09:00:00.000Z'),
    ];
    const facts = [
      makeFact('f1', '2026-04-14T09:00:00.000Z'),
      makeFact('f2', '2026-04-15T09:00:00.000Z'),
      makeFact('f3', '2026-04-16T09:00:00.000Z'),
    ];
    const patterns = [makePattern('p1', '2026-04-15T09:00:00.000Z')];

    const { client, insertedInsights, insertedAuditEvents } = fakeSupabase({
      episodes,
      facts,
      patterns,
    });
    const generate = vi.fn<GenerateFn>().mockResolvedValue({
      text: '{}',
      parsed: {
        body_md: 'The household had a busy week.',
        cited_episodes: ['e1', 'e2'],
        cited_facts: ['f1'],
        cited_patterns: ['p1'],
      },
      model: 'moonshotai/kimi-k2',
      inputTokens: 100,
      outputTokens: 120,
      costUsd: 0.003,
      latencyMs: 400,
    });

    const { runReflector } = await import('./handler.js');
    const report = await runReflector(
      {
        supabase: client as never,
        log: silentLogger(),
        modelClient: fakeModelClient(generate),
      },
      { weekStart: WEEK },
    );

    expect(report).toEqual({ inserted: 1, skipped: 0 });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(insertedInsights).toHaveLength(1);
    expect(insertedInsights[0]!.household_id).toBe(HID);
    expect(insertedInsights[0]!.week_start).toBe(WEEK);
    expect(insertedInsights[0]!.body_md).toContain('busy week');
    // Citation footnote lives inside body_md (schema has no metadata col).
    expect(insertedInsights[0]!.body_md).toContain('homehub:reflection');
    expect(insertedInsights[0]!.body_md).toContain('"cited_episodes":["e1","e2"]');

    expect(insertedAuditEvents).toHaveLength(1);
    const audit = insertedAuditEvents[0]!;
    expect(audit.action).toBe('mem.reflection.completed');
    expect(audit.resource_type).toBe('mem.insight');
    const after = audit.after as Record<string, unknown>;
    expect(after.cited_episodes).toEqual(['e1', 'e2']);
    expect(after.week_start).toBe(WEEK);
    expect(after.cost_usd).toBe(0.003);
  });

  it('skips when an insight row already exists for the week (idempotent)', async () => {
    budgetGuardMock.mockResolvedValue({ ok: true, tier: 'default' });
    const generate = vi.fn<GenerateFn>();

    const { client, insertedInsights } = fakeSupabase({
      existingInsight: { id: 'existing-insight-id' },
      episodes: Array.from({ length: 6 }, (_, i) =>
        makeEpisode(`e${i}`, `2026-04-1${3 + i}T09:00:00.000Z`),
      ),
    });

    const { runReflector } = await import('./handler.js');
    const report = await runReflector(
      {
        supabase: client as never,
        log: silentLogger(),
        modelClient: fakeModelClient(generate),
      },
      { weekStart: WEEK },
    );

    expect(report).toEqual({ inserted: 0, skipped: 1 });
    expect(generate).not.toHaveBeenCalled();
    expect(budgetGuardMock).not.toHaveBeenCalled();
    expect(insertedInsights).toHaveLength(0);
  });

  it('skips when the week has fewer than MIN_EPISODES_PER_WEEK episodes', async () => {
    budgetGuardMock.mockResolvedValue({ ok: true, tier: 'default' });
    const generate = vi.fn<GenerateFn>();

    const { client, insertedInsights, insertedAuditEvents } = fakeSupabase({
      episodes: [
        makeEpisode('e1', '2026-04-13T09:00:00.000Z'),
        makeEpisode('e2', '2026-04-14T09:00:00.000Z'),
        makeEpisode('e3', '2026-04-15T09:00:00.000Z'),
        makeEpisode('e4', '2026-04-16T09:00:00.000Z'),
      ],
    });

    const { runReflector } = await import('./handler.js');
    const report = await runReflector(
      {
        supabase: client as never,
        log: silentLogger(),
        modelClient: fakeModelClient(generate),
      },
      { weekStart: WEEK },
    );

    expect(report).toEqual({ inserted: 0, skipped: 1 });
    expect(generate).not.toHaveBeenCalled();
    expect(budgetGuardMock).not.toHaveBeenCalled();
    expect(insertedInsights).toHaveLength(0);
    expect(insertedAuditEvents).toHaveLength(0);
  });

  it('skips cleanly when the household budget is exceeded', async () => {
    budgetGuardMock.mockResolvedValue({ ok: false, reason: 'budget_exceeded' });
    const generate = vi.fn<GenerateFn>();

    const { client, insertedInsights, insertedAuditEvents } = fakeSupabase({
      episodes: Array.from({ length: 6 }, (_, i) =>
        makeEpisode(`e${i}`, `2026-04-1${3 + i}T09:00:00.000Z`),
      ),
      candidates: [makeCandidate('c1', '2026-04-14T09:00:00.000Z')],
      facts: [makeFact('f1', '2026-04-14T09:00:00.000Z')],
    });

    const { runReflector } = await import('./handler.js');
    const report = await runReflector(
      {
        supabase: client as never,
        log: silentLogger(),
        modelClient: fakeModelClient(generate),
      },
      { weekStart: WEEK },
    );

    expect(report).toEqual({ inserted: 0, skipped: 1 });
    expect(budgetGuardMock).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
    expect(insertedInsights).toHaveLength(0);
    expect(insertedAuditEvents).toHaveLength(0);
  });

  it('returns {inserted:0, skipped:0} when no households exist', async () => {
    budgetGuardMock.mockResolvedValue({ ok: true, tier: 'default' });
    const generate = vi.fn<GenerateFn>();
    const { client } = fakeSupabase({ householdIds: [] });

    const { runReflector } = await import('./handler.js');
    const report = await runReflector(
      {
        supabase: client as never,
        log: silentLogger(),
        modelClient: fakeModelClient(generate),
      },
      { weekStart: WEEK },
    );

    expect(report).toEqual({ inserted: 0, skipped: 0 });
    expect(generate).not.toHaveBeenCalled();
    expect(budgetGuardMock).not.toHaveBeenCalled();
  });
});

describe('mostRecentMondayUtc', () => {
  it('returns the same Monday when called on a Monday', async () => {
    const { mostRecentMondayUtc } = await import('./handler.js');
    expect(mostRecentMondayUtc(new Date('2026-04-20T10:00:00Z'))).toBe('2026-04-20');
  });

  it('returns the previous Monday on a Sunday', async () => {
    const { mostRecentMondayUtc } = await import('./handler.js');
    expect(mostRecentMondayUtc(new Date('2026-04-19T23:00:00Z'))).toBe('2026-04-13');
  });

  it('returns the previous Monday midweek', async () => {
    const { mostRecentMondayUtc } = await import('./handler.js');
    expect(mostRecentMondayUtc(new Date('2026-04-17T12:00:00Z'))).toBe('2026-04-13');
  });
});

describe('appendCitationFootnote', () => {
  it('serializes the citation blob as a trailing HTML comment', async () => {
    const { appendCitationFootnote } = await import('./handler.js');
    const out = appendCitationFootnote(
      {
        body_md: 'hello',
        cited_episodes: ['e1'],
        cited_facts: [],
        cited_patterns: ['p1'],
      },
      '2026-04-13',
    );
    expect(out).toContain('hello');
    expect(out).toMatch(/<!-- homehub:reflection .* -->/);
    expect(out).toContain('"cited_episodes":["e1"]');
    expect(out).toContain('"version":"2026-04-20-reflection-v1"');
  });
});

describe('legacy handler export', () => {
  it('still throws for callers that import the M0 name', async () => {
    const { handler } = await import('./handler.js');
    await expect(handler()).rejects.toThrow(/runReflector/);
  });
});
