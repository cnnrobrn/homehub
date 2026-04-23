/**
 * Per-tool behavior tests.
 *
 * Uses a minimal "supabase double" that records the query chain and
 * returns canned data. This isn't a full query executor — it just lets
 * each tool prove its shape against an in-memory fixture without
 * spinning up a real Postgres.
 */

import { describe, expect, it, vi } from 'vitest';

import { createRuleTool } from './createRule.js';
import { draftWriteStubs, supersedeFactStub } from './draftWriteStubs.js';
import { getAccountBalancesTool } from './getAccountBalances.js';
import { getGroceryListTool } from './getGroceryList.js';
import { getHouseholdMembersTool } from './getHouseholdMembers.js';
import { getPantryTool } from './getPantry.js';
import { listEventsTool } from './listEvents.js';
import { listMealsTool } from './listMeals.js';
import { listSuggestionsTool } from './listSuggestions.js';
import { listTransactionsTool } from './listTransactions.js';
import { queryMemoryTool } from './queryMemory.js';
import { rememberFactTool } from './rememberFact.js';

import type { ToolContext } from '../types.js';

type Row = Record<string, unknown>;

interface QueryBuilder {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  lt: ReturnType<typeof vi.fn>;
  gt: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  or: ReturnType<typeof vi.fn>;
  ilike: ReturnType<typeof vi.fn>;
  contains: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  then: (resolve: (value: { data: unknown; error: null }) => unknown) => unknown;
}

function queryBuilder(rows: Row[]): QueryBuilder {
  const thenable: QueryBuilder = {} as QueryBuilder;
  const chain = (): QueryBuilder => thenable;
  thenable.select = vi.fn(chain);
  thenable.eq = vi.fn(chain);
  thenable.in = vi.fn(chain);
  thenable.gte = vi.fn(chain);
  thenable.lt = vi.fn(chain);
  thenable.gt = vi.fn(chain);
  thenable.is = vi.fn(chain);
  thenable.or = vi.fn(chain);
  thenable.ilike = vi.fn(chain);
  thenable.contains = vi.fn(chain);
  thenable.order = vi.fn(chain);
  thenable.limit = vi.fn(chain);
  thenable.insert = vi.fn(() => queryBuilder([rows[0] ?? {}]));
  thenable.maybeSingle = vi.fn(async () => ({ data: rows[0] ?? null, error: null }));
  thenable.single = vi.fn(async () => ({ data: rows[0] ?? {}, error: null }));
  thenable.then = (resolve) => resolve({ data: rows, error: null });
  return thenable;
}

interface StubSupabase {
  schema: (name: string) => {
    from: (t: string) => QueryBuilder;
  };
}

function stubSupabase(fixtures: Record<string, Record<string, Row[]>>): StubSupabase {
  return {
    schema(name: string) {
      const schemaRows = fixtures[name] ?? {};
      return {
        from(table: string) {
          const rows = schemaRows[table] ?? [];
          return queryBuilder(rows);
        },
      };
    },
  };
}

function mkCtx(sb: StubSupabase, overrides: Partial<ToolContext> = {}): ToolContext {
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  const qm = {
    query: vi.fn(async () => ({
      nodes: [],
      edges: [],
      facts: [],
      episodes: [],
      patterns: [],
      conflicts: [],
    })),
  };
  return {
    householdId: 'hh-1' as ToolContext['householdId'],
    memberId: 'm-1' as ToolContext['memberId'],
    memberRole: 'adult',
    grants: [
      { segment: 'financial', access: 'read' },
      { segment: 'food', access: 'write' },
      { segment: 'fun', access: 'read' },
      { segment: 'social', access: 'read' },
      { segment: 'system', access: 'read' },
    ],
    supabase: sb as unknown as ToolContext['supabase'],
    queryMemory: qm as unknown as ToolContext['queryMemory'],
    log: logger as unknown as ToolContext['log'],
    ...overrides,
  };
}

describe('queryMemory tool', () => {
  it('delegates to the queryMemory client', async () => {
    const sb = stubSupabase({});
    const ctx = mkCtx(sb);
    const qm = ctx.queryMemory.query as ReturnType<typeof vi.fn>;
    qm.mockResolvedValue({
      nodes: [{ id: 'n1' }],
      edges: [],
      facts: [],
      episodes: [],
      patterns: [],
      conflicts: [],
    });
    const res = await queryMemoryTool.handler({ query: 'hi', limit: 5 }, ctx);
    expect(qm).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: 'hh-1', query: 'hi', limit: 5 }),
    );
    expect(res.nodes).toHaveLength(1);
  });
});

describe('listEvents tool', () => {
  it('returns events when the member has a readable segment', async () => {
    const sb = stubSupabase({
      app: {
        event: [
          {
            id: 'e1',
            household_id: 'hh-1',
            segment: 'fun',
            kind: 'meeting',
            title: 'Test',
            starts_at: '2026-04-20T10:00:00Z',
            ends_at: null,
            all_day: false,
            location: null,
            provider: null,
            owner_member_id: null,
            metadata: null,
            source_id: null,
            source_version: null,
            created_at: '2026-04-20T00:00:00Z',
            updated_at: '2026-04-20T00:00:00Z',
          },
        ],
      },
    });
    const ctx = mkCtx(sb);
    const res = await listEventsTool.handler(
      { from: '2026-04-01T00:00:00Z', to: '2026-04-30T23:59:59Z', segments: ['fun'] },
      ctx,
    );
    expect(res.events).toHaveLength(1);
    expect(res.events[0]?.segment).toBe('fun');
  });

  it('returns empty array when scope intersection is empty', async () => {
    const sb = stubSupabase({ app: { event: [] } });
    const ctx = mkCtx(sb, { grants: [{ segment: 'financial', access: 'read' }] });
    const res = await listEventsTool.handler(
      { from: '2026-04-01T00:00:00Z', to: '2026-04-30T23:59:59Z', segments: ['food'] },
      ctx,
    );
    expect(res.events).toEqual([]);
  });

  it('returns empty for an inverted window', async () => {
    const sb = stubSupabase({});
    const ctx = mkCtx(sb);
    const res = await listEventsTool.handler(
      { from: '2026-04-30T00:00:00Z', to: '2026-04-01T00:00:00Z' },
      ctx,
    );
    expect(res.events).toEqual([]);
  });
});

describe('listTransactions tool', () => {
  it('returns empty if the member has no readable accounts', async () => {
    const sb = stubSupabase({
      app: {
        account_grant: [],
        transaction: [],
      },
    });
    const ctx = mkCtx(sb);
    const res = await listTransactionsTool.handler(
      { from: '2026-04-01T00:00:00Z', to: '2026-04-30T23:59:59Z' },
      ctx,
    );
    expect(res.transactions).toEqual([]);
  });

  it('returns matching transactions when grants exist', async () => {
    const sb = stubSupabase({
      app: {
        account_grant: [{ account_id: 'acc-1', access: 'read' }],
        transaction: [
          {
            id: 't1',
            account_id: 'acc-1',
            amount_cents: 5000,
            currency: 'USD',
            merchant_raw: 'Grocery',
            category: 'food',
            occurred_at: '2026-04-10T12:00:00Z',
            member_id: null,
            source: 'plaid',
          },
        ],
      },
    });
    const ctx = mkCtx(sb);
    const res = await listTransactionsTool.handler(
      { from: '2026-04-01T00:00:00Z', to: '2026-04-30T23:59:59Z' },
      ctx,
    );
    expect(res.transactions).toHaveLength(1);
    expect(res.transactions[0]?.amount_cents).toBe(5000);
  });
});

describe('listMeals tool', () => {
  it('returns meals in the window', async () => {
    const sb = stubSupabase({
      app: {
        meal: [
          {
            id: 'meal-1',
            title: 'Chili',
            slot: 'dinner',
            planned_for: '2026-04-20T18:00:00Z',
            status: 'planned',
            servings: 4,
            cook_member_id: null,
            dish_node_id: null,
            notes: null,
          },
        ],
      },
    });
    const ctx = mkCtx(sb);
    const res = await listMealsTool.handler(
      { from: '2026-04-01T00:00:00Z', to: '2026-04-30T23:59:59Z' },
      ctx,
    );
    expect(res.meals).toHaveLength(1);
    expect(res.meals[0]?.title).toBe('Chili');
  });
});

describe('getPantry tool', () => {
  it('returns pantry items', async () => {
    const sb = stubSupabase({
      app: {
        pantry_item: [
          {
            id: 'p1',
            name: 'Rice',
            quantity: 2,
            unit: 'kg',
            location: 'cabinet',
            expires_on: null,
            last_seen_at: null,
          },
        ],
      },
    });
    const ctx = mkCtx(sb);
    const res = await getPantryTool.handler({}, ctx);
    expect(res.items).toHaveLength(1);
  });
});

describe('getGroceryList tool', () => {
  it('returns null list when none exists', async () => {
    const sb = stubSupabase({ app: { grocery_list: [] } });
    const ctx = mkCtx(sb);
    const res = await getGroceryListTool.handler({}, ctx);
    expect(res.list).toBeNull();
    expect(res.items).toEqual([]);
  });

  it('returns latest list + items', async () => {
    const sb = stubSupabase({
      app: {
        grocery_list: [
          {
            id: 'gl-1',
            status: 'draft',
            planned_for: null,
            provider: null,
            external_order_id: null,
            external_url: null,
            created_at: '2026-04-20T00:00:00Z',
            updated_at: '2026-04-20T00:00:00Z',
          },
        ],
        grocery_list_item: [
          { id: 'i-1', list_id: 'gl-1', name: 'Milk', quantity: 1, checked: false },
        ],
      },
    });
    const ctx = mkCtx(sb);
    const res = await getGroceryListTool.handler({}, ctx);
    expect(res.list?.id).toBe('gl-1');
    expect(res.items).toHaveLength(1);
  });
});

describe('getAccountBalances tool', () => {
  it('returns empty when no grants', async () => {
    const sb = stubSupabase({
      app: {
        account_grant: [],
        account: [],
      },
    });
    const ctx = mkCtx(sb);
    const res = await getAccountBalancesTool.handler({}, ctx);
    expect(res.accounts).toEqual([]);
  });

  it('returns readable accounts', async () => {
    const sb = stubSupabase({
      app: {
        account_grant: [{ account_id: 'acc-1', access: 'read' }],
        account: [
          {
            id: 'acc-1',
            name: 'Chase',
            kind: 'checking',
            currency: 'USD',
            balance_cents: 12345,
            provider: 'plaid',
            last_synced_at: '2026-04-19T00:00:00Z',
            owner_member_id: null,
          },
        ],
      },
    });
    const ctx = mkCtx(sb);
    const res = await getAccountBalancesTool.handler({}, ctx);
    expect(res.accounts).toHaveLength(1);
  });
});

describe('listSuggestions tool', () => {
  it('returns pending suggestions by default', async () => {
    const sb = stubSupabase({
      app: {
        suggestion: [
          {
            id: 's1',
            segment: 'food',
            kind: 'meal_plan',
            title: 'Draft week',
            rationale: 'you asked',
            status: 'pending',
            created_at: '2026-04-20T00:00:00Z',
            preview: {},
          },
        ],
      },
    });
    const ctx = mkCtx(sb);
    const res = await listSuggestionsTool.handler({}, ctx);
    expect(res.suggestions).toHaveLength(1);
  });
});

describe('getHouseholdMembers tool', () => {
  it('returns sanitized roster (no email, no user_id)', async () => {
    const sb = stubSupabase({
      app: {
        member: [
          {
            id: 'm1',
            display_name: 'Alex',
            role: 'owner',
            joined_at: '2026-01-01T00:00:00Z',
          },
        ],
      },
    });
    const ctx = mkCtx(sb);
    const res = await getHouseholdMembersTool.handler({}, ctx);
    expect(res.members).toHaveLength(1);
    expect(res.members[0]).not.toHaveProperty('email');
  });
});

describe('rememberFact tool', () => {
  it('requires subject_node_id or subject_name', async () => {
    const sb = stubSupabase({});
    const ctx = mkCtx(sb);
    await expect(rememberFactTool.handler({ predicate: 'likes' }, ctx)).rejects.toMatchObject({
      code: 'invalid_subject',
    });
  });

  it('inserts a pending candidate with subject_node_id', async () => {
    const sb = stubSupabase({
      mem: {
        fact_candidate: [{ id: 'cand-1' }],
      },
    });
    const ctx = mkCtx(sb);
    const res = await rememberFactTool.handler(
      {
        subject_node_id: '00000000-0000-0000-0000-000000000001',
        predicate: 'is_vegetarian',
        object_value: true,
      },
      ctx,
    );
    expect(res.status).toBe('pending');
    expect(res.candidate_id).toBe('cand-1');
  });
});

describe('createRule tool', () => {
  it('inserts an active rule', async () => {
    const sb = stubSupabase({
      mem: { rule: [{ id: 'r-1', active: true }] },
    });
    const ctx = mkCtx(sb);
    const res = await createRuleTool.handler(
      { description: "don't suggest restaurants on Tuesdays" },
      ctx,
    );
    expect(res.rule_id).toBe('r-1');
    expect(res.active).toBe(true);
  });
});

describe('draft-write stubs', () => {
  it('supersede_fact stub returns a pending_approval envelope', async () => {
    const res = await supersedeFactStub.handler(
      {
        fact_id: '00000000-0000-0000-0000-000000000001',
        reason: 'moved',
      },
      {} as never,
    );
    expect(res.status).toBe('pending_approval');
    expect(res.summary).toContain('Supersede');
  });

  it('stubs are all classified as draft-write', () => {
    for (const stub of draftWriteStubs) {
      expect(stub.class).toBe('draft-write');
    }
  });
});
