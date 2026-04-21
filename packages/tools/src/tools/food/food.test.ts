/**
 * Per-tool behavior tests for the food tools.
 *
 * The stub supabase double from the sibling `tools.test.ts` file is
 * duplicated here so food tests stay self-contained.
 */

import { describe, expect, it, vi } from 'vitest';

import { addMealToPlanTool } from './addMealToPlan.js';
import { addPantryItemTool } from './addPantryItem.js';
import { draftMealPlanTool } from './draftMealPlan.js';
import { proposeGroceryOrderTool } from './proposeGroceryOrder.js';
import { removeMealTool } from './removeMeal.js';
import { removePantryItemTool } from './removePantryItem.js';
import { updateMealTool } from './updateMeal.js';
import { updatePantryItemTool } from './updatePantryItem.js';

import type { ToolContext } from '../../types.js';

type Row = Record<string, unknown>;

interface QueryBuilder {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  then: (resolve: (value: { data: unknown; error: null }) => unknown) => unknown;
}

function queryBuilder(rows: Row[]): QueryBuilder {
  const thenable: QueryBuilder = {} as QueryBuilder;
  const chain = (): QueryBuilder => thenable;
  thenable.select = vi.fn(chain);
  thenable.eq = vi.fn(chain);
  thenable.order = vi.fn(chain);
  thenable.limit = vi.fn(chain);
  thenable.insert = vi.fn(() => queryBuilder([rows[0] ?? { id: 'new-id' }]));
  thenable.update = vi.fn(chain);
  thenable.delete = vi.fn(chain);
  thenable.maybeSingle = vi.fn(async () => ({ data: rows[0] ?? null, error: null }));
  thenable.single = vi.fn(async () => ({ data: rows[0] ?? { id: 'new-id' }, error: null }));
  thenable.then = (resolve) => resolve({ data: rows, error: null });
  return thenable;
}

function stubSupabase(fixtures: Record<string, Record<string, Row[]>>) {
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

function mkCtx(
  sb: ReturnType<typeof stubSupabase>,
  overrides: Partial<ToolContext> = {},
): ToolContext {
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
    grants: [{ segment: 'food', access: 'write' }],
    supabase: sb as unknown as ToolContext['supabase'],
    queryMemory: qm as unknown as ToolContext['queryMemory'],
    log: logger as unknown as ToolContext['log'],
    ...overrides,
  };
}

describe('add_meal_to_plan tool', () => {
  it('inserts a meal and returns the id', async () => {
    const sb = stubSupabase({ app: { meal: [{ id: 'meal-1' }] } });
    const ctx = mkCtx(sb);
    const res = await addMealToPlanTool.handler(
      { date: '2026-04-21', slot: 'dinner', dish: 'Tacos', servings: 4 },
      ctx,
    );
    expect(res.meal_id).toBe('meal-1');
    expect(res.status).toBe('planned');
  });

  it('rejects bad dates via schema', async () => {
    const parsed = addMealToPlanTool.input.safeParse({
      date: 'not-a-date',
      slot: 'dinner',
      dish: 'Tacos',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('update_meal tool', () => {
  it('requires at least one field', async () => {
    const sb = stubSupabase({});
    const ctx = mkCtx(sb);
    await expect(
      updateMealTool.handler({ meal_id: '00000000-0000-0000-0000-000000000001' }, ctx),
    ).rejects.toMatchObject({ code: 'invalid_patch' });
  });

  it('patches supplied fields', async () => {
    const sb = stubSupabase({ app: { meal: [] } });
    const ctx = mkCtx(sb);
    const res = await updateMealTool.handler(
      {
        meal_id: '00000000-0000-0000-0000-000000000001',
        status: 'served',
        servings: 2,
      },
      ctx,
    );
    expect(res.updated_fields).toEqual(['status', 'servings']);
  });
});

describe('remove_meal tool', () => {
  it('deletes a meal', async () => {
    const sb = stubSupabase({ app: { meal: [] } });
    const ctx = mkCtx(sb);
    const res = await removeMealTool.handler(
      { meal_id: '00000000-0000-0000-0000-000000000001' },
      ctx,
    );
    expect(res.deleted).toBe(true);
  });
});

describe('add_pantry_item tool', () => {
  it('inserts a pantry item', async () => {
    const sb = stubSupabase({ app: { pantry_item: [{ id: 'pi-1' }] } });
    const ctx = mkCtx(sb);
    const res = await addPantryItemTool.handler({ name: 'Rice', quantity: 2, unit: 'kg' }, ctx);
    expect(res.pantry_item_id).toBe('pi-1');
  });
});

describe('update_pantry_item tool', () => {
  it('requires at least one field', async () => {
    const sb = stubSupabase({});
    const ctx = mkCtx(sb);
    await expect(
      updatePantryItemTool.handler({ pantry_item_id: '00000000-0000-0000-0000-000000000001' }, ctx),
    ).rejects.toMatchObject({ code: 'invalid_patch' });
  });

  it('patches supplied fields', async () => {
    const sb = stubSupabase({ app: { pantry_item: [] } });
    const ctx = mkCtx(sb);
    const res = await updatePantryItemTool.handler(
      {
        pantry_item_id: '00000000-0000-0000-0000-000000000001',
        quantity: 0.5,
      },
      ctx,
    );
    expect(res.updated_fields).toEqual(['quantity']);
  });
});

describe('remove_pantry_item tool', () => {
  it('deletes a pantry item', async () => {
    const sb = stubSupabase({ app: { pantry_item: [] } });
    const ctx = mkCtx(sb);
    const res = await removePantryItemTool.handler(
      { pantry_item_id: '00000000-0000-0000-0000-000000000001' },
      ctx,
    );
    expect(res.deleted).toBe(true);
  });
});

describe('draft_meal_plan tool', () => {
  it('creates a pending suggestion with preview meals', async () => {
    const sb = stubSupabase({
      mem: { node: [{ id: 'd-1', canonical_name: 'Tacos' }] },
      app: { suggestion: [{ id: 'sug-1' }] },
    });
    const ctx = mkCtx(sb);
    const res = await draftMealPlanTool.handler(
      { start_date: '2026-04-20', end_date: '2026-04-22' },
      ctx,
    );
    expect(res.status).toBe('pending_approval');
    expect(res.suggestion_id).toBe('sug-1');
    expect(res.preview.meals).toHaveLength(3);
    expect(res.preview.meals[0]?.slot).toBe('dinner');
  });

  it('rejects inverted date ranges', async () => {
    const sb = stubSupabase({ mem: { node: [] } });
    const ctx = mkCtx(sb);
    await expect(
      draftMealPlanTool.handler({ start_date: '2026-04-22', end_date: '2026-04-20' }, ctx),
    ).rejects.toMatchObject({ code: 'invalid_range' });
  });
});

describe('propose_grocery_order tool', () => {
  it('creates a pending suggestion with items', async () => {
    const sb = stubSupabase({ app: { suggestion: [{ id: 'sug-2' }] } });
    const ctx = mkCtx(sb);
    const res = await proposeGroceryOrderTool.handler(
      {
        planned_for: '2026-04-25',
        items: [{ name: 'Milk', quantity: 1, unit: 'gal' }],
      },
      ctx,
    );
    expect(res.status).toBe('pending_approval');
    expect(res.suggestion_id).toBe('sug-2');
    expect(res.preview.items).toHaveLength(1);
  });

  it('requires at least one item', async () => {
    const parsed = proposeGroceryOrderTool.input.safeParse({
      planned_for: '2026-04-25',
      items: [],
    });
    expect(parsed.success).toBe(false);
  });
});
