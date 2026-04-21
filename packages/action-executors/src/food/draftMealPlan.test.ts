import { describe, expect, it } from 'vitest';

import { PermanentExecutorError } from '../errors.js';
import { makeAction, makeFakeSupabase, makeSuggestion, runExecutor } from '../testutil.js';

import { createDraftMealPlanExecutor } from './draftMealPlan.js';

describe('createDraftMealPlanExecutor', () => {
  it('inserts new meal rows and returns the ids', async () => {
    const { supabase, db } = makeFakeSupabase({ app: { meal: [] } });
    const executor = createDraftMealPlanExecutor({
      supabase,
      now: () => new Date('2026-04-20T00:00:00Z'),
    });

    const result = await runExecutor(executor, {
      action: makeAction({ kind: 'draft_meal_plan' }),
      suggestion: makeSuggestion({
        kind: 'draft_meal_plan',
        preview: {
          meals: [
            { planned_for: '2026-04-20', slot: 'dinner', title: 'Pasta', servings: 4 },
            { planned_for: '2026-04-21', slot: 'dinner', title: 'Tacos', servings: 4 },
          ],
        },
      }),
      supabase,
    });

    expect((result.result as { inserted_count: number }).inserted_count).toBe(2);
    expect(db.app!.meal).toHaveLength(2);
    expect(db.app!.meal![0]!.title).toBe('Pasta');
  });

  it('updates existing rows on conflict (idempotency)', async () => {
    const { supabase, db } = makeFakeSupabase({
      app: {
        meal: [
          {
            id: 'meal-existing',
            household_id: 'h1',
            planned_for: '2026-04-20',
            slot: 'dinner',
            title: 'Old Title',
            status: 'planned',
          },
        ],
      },
    });
    const executor = createDraftMealPlanExecutor({ supabase });

    const result = await runExecutor(executor, {
      action: makeAction(),
      suggestion: makeSuggestion({
        preview: {
          meals: [{ planned_for: '2026-04-20', slot: 'dinner', title: 'New Title' }],
        },
      }),
      supabase,
    });

    expect((result.result as { updated_count: number }).updated_count).toBe(1);
    expect((result.result as { inserted_count: number }).inserted_count).toBe(0);
    expect(db.app!.meal).toHaveLength(1);
    expect(db.app!.meal![0]!.title).toBe('New Title');
  });

  it('validates payload — empty meals rejects', async () => {
    const { supabase } = makeFakeSupabase();
    const executor = createDraftMealPlanExecutor({ supabase });

    await expect(
      runExecutor(executor, {
        action: makeAction(),
        suggestion: makeSuggestion({ preview: { meals: [] } }),
        supabase,
      }),
    ).rejects.toBeInstanceOf(PermanentExecutorError);
  });
});
