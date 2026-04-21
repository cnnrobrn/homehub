/**
 * Executor for the `draft_meal_plan` action kind.
 *
 * Unlike the calendar / email executors, this one is pure-DB — there
 * is no external provider for HomeHub's native meal planner. We write
 * N `app.meal` rows from the approved preview.
 *
 * Idempotency: the executor is idempotent on `(household_id,
 * planned_for, slot)`. If a meal row already exists at that slot we
 * UPDATE it rather than insert a duplicate. This matches the unique
 * key the `app.meal` schema enforces and keeps re-runs safe.
 */

import { type Json } from '@homehub/db';
import { z } from 'zod';

import { coerceRecord, PermanentExecutorError, toPayloadInvalidError } from '../errors.js';
import { type ActionExecutor, type ExecutorDeps } from '../types.js';

const mealSchema = z.object({
  planned_for: z.string().min(1, 'planned_for is required (ISO date)'),
  slot: z.string().min(1, 'slot is required'),
  dish_node_id: z.string().uuid().optional().nullable(),
  title: z.string().min(1, 'title is required'),
  servings: z.number().int().positive().optional(),
  cook_member_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional(),
});

export const draftMealPlanPayloadSchema = z.object({
  meals: z.array(mealSchema).min(1, 'at least one meal required'),
});

export type DraftMealPlanPayload = z.infer<typeof draftMealPlanPayloadSchema>;

export interface CreateDraftMealPlanExecutorArgs {
  supabase: ExecutorDeps['supabase'];
  now?: () => Date;
}

export function createDraftMealPlanExecutor(deps: CreateDraftMealPlanExecutorArgs): ActionExecutor {
  const now = deps.now ?? (() => new Date());
  return async ({ action, suggestion, log }) => {
    const payloadCandidate = {
      ...coerceRecord(suggestion.preview),
      ...coerceRecord(action.payload),
    };
    let payload: DraftMealPlanPayload;
    try {
      payload = draftMealPlanPayloadSchema.parse(payloadCandidate);
    } catch (err) {
      throw toPayloadInvalidError(err);
    }

    const stamp = now().toISOString();
    const mealIds: string[] = [];
    let inserted = 0;
    let updated = 0;

    for (const meal of payload.meals) {
      // Look up existing row for the (household, planned_for, slot)
      // tuple. Supabase doesn't offer partial-unique upsert on a
      // non-conflicting column (`title`), so we do an explicit
      // read-then-insert/update. The blast radius is bounded — a
      // single approved meal plan is at most ~21 rows (3 slots × 7 days).
      const { data: existing, error: readErr } = await deps.supabase
        .schema('app')
        .from('meal')
        .select('id')
        .eq('household_id', action.household_id)
        .eq('planned_for', meal.planned_for)
        .eq('slot', meal.slot)
        .maybeSingle();
      if (readErr) {
        throw new Error(`app.meal read failed: ${readErr.message}`);
      }

      if (existing) {
        const { error: updErr } = await deps.supabase
          .schema('app')
          .from('meal')
          .update({
            title: meal.title,
            dish_node_id: meal.dish_node_id ?? null,
            cook_member_id: meal.cook_member_id ?? null,
            servings: meal.servings ?? null,
            notes: meal.notes ?? null,
            updated_at: stamp,
          })
          .eq('id', existing.id);
        if (updErr) {
          throw new Error(`app.meal update failed: ${updErr.message}`);
        }
        mealIds.push(existing.id);
        updated += 1;
      } else {
        const { data: insertData, error: insErr } = await deps.supabase
          .schema('app')
          .from('meal')
          .insert({
            household_id: action.household_id,
            planned_for: meal.planned_for,
            slot: meal.slot,
            title: meal.title,
            dish_node_id: meal.dish_node_id ?? null,
            cook_member_id: meal.cook_member_id ?? null,
            servings: meal.servings ?? null,
            notes: meal.notes ?? null,
            status: 'planned',
            updated_at: stamp,
          })
          .select('id')
          .single();
        if (insErr || !insertData) {
          throw new Error(`app.meal insert failed: ${insErr?.message ?? 'no row returned'}`);
        }
        // Accept either a well-typed Row or a generic Row object.
        const id = (insertData as { id: string }).id;
        if (!id) {
          throw new PermanentExecutorError(
            'meal_insert_missing_id',
            'app.meal insert did not return a row id',
          );
        }
        mealIds.push(id);
        inserted += 1;
      }
    }

    log.info('meal plan written', {
      inserted_count: inserted,
      updated_count: updated,
      total: mealIds.length,
    });

    return {
      result: {
        inserted_count: inserted,
        updated_count: updated,
        meal_ids: mealIds as unknown as Json,
      },
    };
  };
}
