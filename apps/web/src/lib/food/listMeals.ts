/**
 * `listMeals` — server-side reader for `app.meal`.
 *
 * Powers `/food/meal-planner` + the dashboard "next 7 days" strip.
 * Always runs under the authed Supabase client so RLS is the last line
 * of defense; the helper additionally short-circuits when the caller
 * lacks `food:read`.
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { hasFoodRead, type MealSlot, type MealStatus, type SegmentGrant } from './types';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const listMealsArgsSchema = z.object({
  householdId: z.string().uuid(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  slot: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export type ListMealsArgs = z.infer<typeof listMealsArgsSchema>;

export interface MealRow {
  id: string;
  householdId: string;
  plannedFor: string;
  slot: MealSlot;
  title: string;
  dishNodeId: string | null;
  cookMemberId: string | null;
  servings: number | null;
  status: MealStatus;
  notes: string | null;
}

type MealRowDb = Database['app']['Tables']['meal']['Row'];

function toCamel(row: MealRowDb): MealRow {
  return {
    id: row.id,
    householdId: row.household_id,
    plannedFor: row.planned_for,
    slot: row.slot as MealSlot,
    title: row.title,
    dishNodeId: row.dish_node_id ?? null,
    cookMemberId: row.cook_member_id ?? null,
    servings: row.servings ?? null,
    status: row.status as MealStatus,
    notes: row.notes ?? null,
  };
}

export interface ListMealsDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
}

export async function listMeals(args: ListMealsArgs, deps: ListMealsDeps = {}): Promise<MealRow[]> {
  const parsed = listMealsArgsSchema.parse(args);
  if (deps.grants && !hasFoodRead(deps.grants)) return [];
  const client = deps.client ?? (await createClient());
  let query = client
    .schema('app')
    .from('meal')
    .select(
      'id, household_id, planned_for, slot, title, dish_node_id, cook_member_id, servings, status, notes',
    )
    .eq('household_id', parsed.householdId);
  if (parsed.from) query = query.gte('planned_for', parsed.from);
  if (parsed.to) query = query.lte('planned_for', parsed.to);
  if (parsed.slot) query = query.eq('slot', parsed.slot);
  query = query.order('planned_for', { ascending: true }).limit(parsed.limit ?? 200);
  const { data, error } = await query;
  if (error) throw new Error(`listMeals: ${error.message}`);
  return (data ?? []).map((r) => toCamel(r as MealRowDb));
}
