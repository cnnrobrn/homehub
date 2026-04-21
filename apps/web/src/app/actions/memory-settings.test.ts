/**
 * Tests for the `/settings/memory` server actions.
 *
 * Separate file from `memory.test.ts` because these actions hit a
 * different surface (`app.household.settings`, `mem.rule`, `mem.insight`,
 * `audit.event`, `app.model_calls`) and need a more configurable
 * Supabase shim.
 *
 * Scope per dispatch:
 *   - Happy path: envelope, audit call, table write shape.
 *   - Auth failure: no session → UNAUTHORIZED envelope.
 *   - Owner gate: non-owner edits to owner-gated actions → UNAUTHORIZED.
 *   - Validation failure: bad input → VALIDATION envelope.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mocks,
  FakeAuthServerError,
  FakeUnauthorizedError,
  FakeValidationError,
  supabaseState,
  resetSupabaseState,
} = vi.hoisted(() => {
  class FakeAuthServerError extends Error {
    code = 'INTERNAL';
  }
  class FakeUnauthorizedError extends FakeAuthServerError {
    override code = 'UNAUTHORIZED';
    constructor(message: string) {
      super(message);
      this.name = 'UnauthorizedError';
    }
  }
  class FakeValidationError extends FakeAuthServerError {
    override code = 'VALIDATION';
    issues: Array<{ path: string; message: string }> = [];
    constructor(
      messageOrIssues: string | Array<{ path: string; message: string }>,
      maybeIssues?: Array<{ path: string; message: string }>,
    ) {
      super(typeof messageOrIssues === 'string' ? messageOrIssues : 'validation');
      this.issues = Array.isArray(messageOrIssues) ? messageOrIssues : (maybeIssues ?? []);
    }
  }

  interface State {
    household: { settings: Record<string, unknown> };
    rules: Array<Record<string, unknown>>;
    insights: Array<Record<string, unknown>>;
    modelCalls: Array<{ cost_usd: number; at: string }>;
    auditEvents: Array<Record<string, unknown>>;
    inserts: Array<{ schema: string; table: string; row: Record<string, unknown> }>;
    updates: Array<{ schema: string; table: string; patch: Record<string, unknown> }>;
    deletes: Array<{ schema: string; table: string }>;
  }

  const state: State = {
    household: { settings: {} },
    rules: [],
    insights: [],
    modelCalls: [],
    auditEvents: [],
    inserts: [],
    updates: [],
    deletes: [],
  };

  return {
    mocks: {
      getUser: vi.fn(),
      createServiceClient: vi.fn(),
      writeAuditEvent: vi.fn(async (_c: unknown, row: Record<string, unknown>) => {
        state.auditEvents.push(row);
      }),
      getHouseholdContext: vi.fn(),
    },
    FakeAuthServerError,
    FakeUnauthorizedError,
    FakeValidationError,
    supabaseState: state,
    resetSupabaseState() {
      state.household = { settings: {} };
      state.rules = [];
      state.insights = [];
      state.modelCalls = [];
      state.auditEvents = [];
      state.inserts = [];
      state.updates = [];
      state.deletes = [];
    },
  };
});

function makeFakeSupabase() {
  return {
    schema(schemaName: string) {
      return {
        from(table: string) {
          let pendingInsert: Record<string, unknown> | null = null;
          let pendingUpdate: Record<string, unknown> | null = null;
          let pendingDelete = false;
          let wantSingle = false;

          const chain: Record<string, unknown> = {
            select() {
              return chain;
            },
            single() {
              wantSingle = true;
              return chain;
            },
            order() {
              return chain;
            },
            limit() {
              return chain;
            },
            eq() {
              return chain;
            },
            neq() {
              return chain;
            },
            gte() {
              return chain;
            },
            in() {
              return chain;
            },
            maybeSingle() {
              let row: unknown = null;
              if (schemaName === 'app' && table === 'household') {
                row = supabaseState.household;
              } else if (schemaName === 'mem' && table === 'rule') {
                row = supabaseState.rules[0] ?? null;
              } else if (schemaName === 'mem' && table === 'insight') {
                row = supabaseState.insights[0] ?? null;
              }
              return Promise.resolve({ data: row, error: null });
            },
            then(resolve: (v: { data: unknown; error: null }) => void) {
              if (pendingInsert) {
                supabaseState.inserts.push({
                  schema: schemaName,
                  table,
                  row: pendingInsert,
                });
                const id = `id-${supabaseState.inserts.length}`;
                resolve({ data: wantSingle ? { id } : [{ id }], error: null });
                pendingInsert = null;
                return;
              }
              if (pendingUpdate) {
                supabaseState.updates.push({
                  schema: schemaName,
                  table,
                  patch: pendingUpdate,
                });
                resolve({ data: null, error: null });
                pendingUpdate = null;
                return;
              }
              if (pendingDelete) {
                supabaseState.deletes.push({ schema: schemaName, table });
                resolve({ data: null, error: null });
                pendingDelete = false;
                return;
              }
              // Table read that doesn't hit maybeSingle.
              if (schemaName === 'mem' && table === 'rule') {
                resolve({ data: supabaseState.rules, error: null });
                return;
              }
              if (schemaName === 'app' && table === 'model_calls') {
                resolve({ data: supabaseState.modelCalls, error: null });
                return;
              }
              if (schemaName === 'mem' && table === 'insight') {
                resolve({ data: supabaseState.insights, error: null });
                return;
              }
              if (schemaName === 'audit' && table === 'event') {
                resolve({ data: supabaseState.auditEvents, error: null });
                return;
              }
              resolve({ data: [], error: null });
            },
          };

          return {
            ...chain,
            insert(row: Record<string, unknown>) {
              pendingInsert = row;
              return chain;
            },
            update(patch: Record<string, unknown>) {
              pendingUpdate = patch;
              return chain;
            },
            delete() {
              pendingDelete = true;
              return chain;
            },
          };
        },
      };
    },
  };
}

vi.mock('@homehub/auth-server', () => ({
  getUser: mocks.getUser,
  createServiceClient: mocks.createServiceClient,
  writeAuditEvent: mocks.writeAuditEvent,
  // Passthroughs used by the memory graph-browser actions but not hit
  // by this test file. Provide stub identities so the module imports.
  resolveMemberId: vi.fn(),
  UnauthorizedError: FakeUnauthorizedError,
  AuthServerError: FakeAuthServerError,
  ValidationError: FakeValidationError,
}));

vi.mock('@/lib/auth/env', () => ({
  authEnv: () => ({ INVITATION_TOKEN_SECRET: 'x'.repeat(64), INVITATION_TTL_DAYS: 7 }),
}));

vi.mock('@/lib/auth/cookies', () => ({
  nextCookieAdapter: async () => ({ getAll: () => [], setAll: () => {} }),
}));

vi.mock('@/lib/auth/context', () => ({
  getHouseholdContext: mocks.getHouseholdContext,
}));

vi.mock('@/lib/memory/query', () => ({
  queryHouseholdMemory: vi.fn(async () => ({
    nodes: [],
    facts: [],
    episodes: [],
    edges: [],
    patterns: [],
    conflicts: [],
  })),
}));

import {
  cancelForgetAllAction,
  confirmInsightAction,
  createRuleAction,
  deleteRuleAction,
  dismissInsightAction,
  getForgetAllRequestAction,
  getMonthToDateModelSpendAction,
  listHouseholdRulesAction,
  listInsightsAction,
  requestForgetAllAction,
  toggleMemoryWritesAction,
  updateModelBudgetAction,
  updateRetentionWindowsAction,
  updateRuleAction,
} from './memory';

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com' };
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const RULE_ID = '44444444-4444-4444-8444-444444444444';
const INSIGHT_ID = '55555555-5555-4555-8555-555555555555';

function mockOwnerContext() {
  mocks.getHouseholdContext.mockResolvedValue({
    household: { id: HOUSEHOLD_ID, name: 'home', settings: supabaseState.household.settings },
    member: { id: MEMBER_ID, role: 'owner' },
    grants: [],
  });
}

function mockAdultContext() {
  mocks.getHouseholdContext.mockResolvedValue({
    household: { id: HOUSEHOLD_ID, name: 'home', settings: supabaseState.household.settings },
    member: { id: MEMBER_ID, role: 'adult' },
    grants: [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetSupabaseState();
  mocks.createServiceClient.mockReturnValue(makeFakeSupabase());
  mocks.getUser.mockResolvedValue(USER);
  mockOwnerContext();
});

// ===========================================================================
// toggleMemoryWritesAction
// ===========================================================================

describe('toggleMemoryWritesAction', () => {
  it('owner pause → flips settings + audits', async () => {
    const res = await toggleMemoryWritesAction({ paused: true });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.paused).toBe(true);
    const update = supabaseState.updates.find((u) => u.schema === 'app' && u.table === 'household');
    expect(update).toBeTruthy();
    const patch = update?.patch.settings as {
      memory?: { writes_paused?: boolean };
    };
    expect(patch?.memory?.writes_paused).toBe(true);
    expect(supabaseState.auditEvents[0]?.action).toBe('mem.writes.paused');
  });

  it('non-owner rejected', async () => {
    mockAdultContext();
    const res = await toggleMemoryWritesAction({ paused: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('UNAUTHORIZED');
  });

  it('no session rejected', async () => {
    mocks.getUser.mockResolvedValue(null);
    mocks.getHouseholdContext.mockResolvedValue(null);
    const res = await toggleMemoryWritesAction({ paused: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects non-boolean', async () => {
    const res = await toggleMemoryWritesAction({ paused: 'yes' } as never);
    expect(res.ok).toBe(false);
  });
});

// ===========================================================================
// updateRetentionWindowsAction
// ===========================================================================

describe('updateRetentionWindowsAction', () => {
  it('stores retention days under the category', async () => {
    const res = await updateRetentionWindowsAction({ category: 'raw_emails', days: 120 });
    expect(res.ok).toBe(true);
    const update = supabaseState.updates.find((u) => u.schema === 'app' && u.table === 'household');
    const patch = update?.patch.settings as {
      memory?: { retention_days?: Record<string, number> };
    };
    expect(patch?.memory?.retention_days?.raw_emails).toBe(120);
    expect(supabaseState.auditEvents[0]?.action).toBe('mem.retention.updated');
  });

  it('rejects out-of-range values', async () => {
    const res = await updateRetentionWindowsAction({ category: 'raw_emails', days: 5 });
    expect(res.ok).toBe(false);
  });

  it('rejects unknown category', async () => {
    const res = await updateRetentionWindowsAction({
      category: 'nope' as never,
      days: 90,
    });
    expect(res.ok).toBe(false);
  });

  it('non-owner rejected', async () => {
    mockAdultContext();
    const res = await updateRetentionWindowsAction({ category: 'raw_emails', days: 120 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('UNAUTHORIZED');
  });
});

// ===========================================================================
// updateModelBudgetAction / getMonthToDateModelSpendAction
// ===========================================================================

describe('updateModelBudgetAction', () => {
  it('owner saves budget in cents', async () => {
    const res = await updateModelBudgetAction({ cents: 2_500 });
    expect(res.ok).toBe(true);
    const update = supabaseState.updates.find((u) => u.schema === 'app' && u.table === 'household');
    const patch = update?.patch.settings as {
      memory?: { model_budget_monthly_cents?: number };
    };
    expect(patch?.memory?.model_budget_monthly_cents).toBe(2_500);
    expect(supabaseState.auditEvents[0]?.action).toBe('mem.model_budget.updated');
  });

  it('rejects negatives', async () => {
    const res = await updateModelBudgetAction({ cents: -1 });
    expect(res.ok).toBe(false);
  });

  it('rejects values above the cap', async () => {
    const res = await updateModelBudgetAction({ cents: 1_000_001 });
    expect(res.ok).toBe(false);
  });

  it('non-owner rejected', async () => {
    mockAdultContext();
    const res = await updateModelBudgetAction({ cents: 1_000 });
    expect(res.ok).toBe(false);
  });
});

describe('getMonthToDateModelSpendAction', () => {
  it('sums app.model_calls.cost_usd', async () => {
    supabaseState.modelCalls = [
      { cost_usd: 0.25, at: new Date().toISOString() },
      { cost_usd: 1.5, at: new Date().toISOString() },
    ];
    const res = await getMonthToDateModelSpendAction();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.usd).toBeCloseTo(1.75, 5);
  });

  it('rejects unauthenticated', async () => {
    mocks.getUser.mockResolvedValue(null);
    mocks.getHouseholdContext.mockResolvedValue(null);
    const res = await getMonthToDateModelSpendAction();
    expect(res.ok).toBe(false);
  });
});

// ===========================================================================
// Rule actions
// ===========================================================================

describe('listHouseholdRulesAction', () => {
  it('returns rules with author resolution + isMine flag', async () => {
    supabaseState.rules = [
      {
        id: RULE_ID,
        author_member_id: MEMBER_ID,
        description: 'No peanuts',
        predicate_dsl: { forbid: 'peanut' },
        active: true,
        created_at: new Date().toISOString(),
      },
    ];
    const res = await listHouseholdRulesAction();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toHaveLength(1);
      expect(res.data[0]?.isMine).toBe(true);
      expect(res.data[0]?.description).toBe('No peanuts');
    }
  });
});

describe('createRuleAction', () => {
  it('inserts a rule authored by the caller', async () => {
    const res = await createRuleAction({ description: 'No peanuts' });
    expect(res.ok).toBe(true);
    const insert = supabaseState.inserts.find((i) => i.schema === 'mem' && i.table === 'rule');
    expect(insert?.row.description).toBe('No peanuts');
    expect(insert?.row.author_member_id).toBe(MEMBER_ID);
    expect(insert?.row.active).toBe(true);
    expect(supabaseState.auditEvents[0]?.action).toBe('mem.rule.created');
  });

  it('rejects empty description', async () => {
    const res = await createRuleAction({ description: '' });
    expect(res.ok).toBe(false);
  });

  it('rejects unauthenticated', async () => {
    mocks.getUser.mockResolvedValue(null);
    mocks.getHouseholdContext.mockResolvedValue(null);
    const res = await createRuleAction({ description: 'x' });
    expect(res.ok).toBe(false);
  });
});

describe('updateRuleAction', () => {
  it('updates a rule the caller authored', async () => {
    supabaseState.rules = [
      {
        id: RULE_ID,
        household_id: HOUSEHOLD_ID,
        author_member_id: MEMBER_ID,
        description: 'old',
        predicate_dsl: {},
        active: true,
        created_at: new Date().toISOString(),
      },
    ];
    const res = await updateRuleAction({ ruleId: RULE_ID, description: 'new' });
    expect(res.ok).toBe(true);
    const update = supabaseState.updates.find((u) => u.schema === 'mem' && u.table === 'rule');
    expect(update?.patch.description).toBe('new');
  });

  it('rejects updating another member’s rule', async () => {
    supabaseState.rules = [
      {
        id: RULE_ID,
        household_id: HOUSEHOLD_ID,
        author_member_id: 'someone-else',
        description: 'old',
        predicate_dsl: {},
        active: true,
        created_at: new Date().toISOString(),
      },
    ];
    const res = await updateRuleAction({ ruleId: RULE_ID, description: 'new' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects when no field provided', async () => {
    const res = await updateRuleAction({ ruleId: RULE_ID } as never);
    expect(res.ok).toBe(false);
  });
});

describe('deleteRuleAction', () => {
  it('deletes a rule the caller authored', async () => {
    supabaseState.rules = [
      {
        id: RULE_ID,
        household_id: HOUSEHOLD_ID,
        author_member_id: MEMBER_ID,
        description: 'old',
        predicate_dsl: {},
        active: true,
        created_at: new Date().toISOString(),
      },
    ];
    const res = await deleteRuleAction({ ruleId: RULE_ID });
    expect(res.ok).toBe(true);
    expect(supabaseState.deletes.some((d) => d.schema === 'mem' && d.table === 'rule')).toBe(true);
    expect(supabaseState.auditEvents[0]?.action).toBe('mem.rule.deleted');
  });

  it('rejects deleting another member’s rule', async () => {
    supabaseState.rules = [
      {
        id: RULE_ID,
        household_id: HOUSEHOLD_ID,
        author_member_id: 'someone-else',
        description: 'old',
        predicate_dsl: {},
        active: true,
        created_at: new Date().toISOString(),
      },
    ];
    const res = await deleteRuleAction({ ruleId: RULE_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('UNAUTHORIZED');
  });
});

// ===========================================================================
// Insight actions
// ===========================================================================

describe('listInsightsAction', () => {
  it('returns insights for the household', async () => {
    supabaseState.insights = [
      {
        id: INSIGHT_ID,
        week_start: '2026-04-14',
        body_md: 'Body',
        created_at: new Date().toISOString(),
        promoted_to_rule_id: null,
      },
    ];
    const res = await listInsightsAction({ limit: 5 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toHaveLength(1);
      expect(res.data[0]?.id).toBe(INSIGHT_ID);
    }
  });

  it('rejects unauthenticated', async () => {
    mocks.getUser.mockResolvedValue(null);
    mocks.getHouseholdContext.mockResolvedValue(null);
    const res = await listInsightsAction();
    expect(res.ok).toBe(false);
  });

  it('rejects invalid limit', async () => {
    const res = await listInsightsAction({ limit: -1 });
    expect(res.ok).toBe(false);
  });
});

describe('confirmInsightAction', () => {
  it('writes an audit event for the confirmation', async () => {
    supabaseState.insights = [
      {
        id: INSIGHT_ID,
        household_id: HOUSEHOLD_ID,
        week_start: '2026-04-14',
        body_md: 'Body',
        created_at: new Date().toISOString(),
      },
    ];
    const res = await confirmInsightAction({ insightId: INSIGHT_ID });
    expect(res.ok).toBe(true);
    expect(supabaseState.auditEvents[0]?.action).toBe('mem.insight.confirmed');
  });

  it('rejects invalid uuid', async () => {
    const res = await confirmInsightAction({ insightId: 'nope' } as never);
    expect(res.ok).toBe(false);
  });
});

describe('dismissInsightAction', () => {
  it('writes an audit event for the dismissal', async () => {
    supabaseState.insights = [
      {
        id: INSIGHT_ID,
        household_id: HOUSEHOLD_ID,
        week_start: '2026-04-14',
        body_md: 'Body',
        created_at: new Date().toISOString(),
      },
    ];
    const res = await dismissInsightAction({ insightId: INSIGHT_ID });
    expect(res.ok).toBe(true);
    expect(supabaseState.auditEvents[0]?.action).toBe('mem.insight.dismissed');
  });
});

// ===========================================================================
// Forget-all (danger zone)
// ===========================================================================

describe('requestForgetAllAction', () => {
  it('owner can schedule a forget-all', async () => {
    const res = await requestForgetAllAction();
    expect(res.ok).toBe(true);
    expect(supabaseState.auditEvents[0]?.action).toBe('mem.forget_all.requested');
  });

  it('non-owner rejected', async () => {
    mockAdultContext();
    const res = await requestForgetAllAction();
    expect(res.ok).toBe(false);
  });
});

describe('cancelForgetAllAction', () => {
  it('owner can cancel', async () => {
    const res = await cancelForgetAllAction();
    expect(res.ok).toBe(true);
    expect(supabaseState.auditEvents[0]?.action).toBe('mem.forget_all.canceled');
  });

  it('non-owner rejected', async () => {
    mockAdultContext();
    const res = await cancelForgetAllAction();
    expect(res.ok).toBe(false);
  });
});

describe('getForgetAllRequestAction', () => {
  it('returns null when no pending request exists', async () => {
    const res = await getForgetAllRequestAction();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toBeNull();
  });
});
