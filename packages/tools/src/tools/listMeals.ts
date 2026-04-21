/**
 * `list_meals` — window read of `app.meal`.
 *
 * Requires `food:read`.
 */

import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../types.js';

interface MealRow {
  id: string;
  title: string;
  slot: string;
  planned_for: string;
  status: string;
  servings: number | null;
  cook_member_id: string | null;
  dish_node_id: string | null;
  notes: string | null;
}

const inputSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  slot: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const mealSchema = z.object({
  id: z.string(),
  title: z.string(),
  slot: z.string(),
  planned_for: z.string(),
  status: z.string(),
  servings: z.number().nullable(),
  cook_member_id: z.string().nullable(),
  dish_node_id: z.string().nullable(),
  notes: z.string().nullable(),
});

const outputSchema = z.object({ meals: z.array(mealSchema) });

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const listMealsTool: ToolDefinition<Input, Output> = {
  name: 'list_meals',
  description: 'List planned meals in a date range.',
  class: 'read',
  input: inputSchema,
  output: outputSchema,
  segments: ['food'],
  async handler(args, ctx) {
    if (new Date(args.to).getTime() <= new Date(args.from).getTime()) {
      return { meals: [] };
    }
    let q = ctx.supabase
      .schema('app')
      .from('meal')
      .select('id, title, slot, planned_for, status, servings, cook_member_id, dish_node_id, notes')
      .eq('household_id', ctx.householdId)
      .gte('planned_for', args.from)
      .lt('planned_for', args.to);
    if (args.slot) q = q.eq('slot', args.slot);
    q = q.order('planned_for', { ascending: true }).limit(args.limit ?? 50);
    const { data, error } = await q;
    if (error) throw new ToolError('db_error', `list_meals: ${error.message}`);
    return {
      meals: (data ?? []).map((m: MealRow) => ({
        id: m.id,
        title: m.title,
        slot: m.slot,
        planned_for: m.planned_for,
        status: m.status,
        servings: m.servings,
        cook_member_id: m.cook_member_id,
        dish_node_id: m.dish_node_id,
        notes: m.notes,
      })),
    };
  },
};
