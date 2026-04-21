/**
 * `add_meal_to_plan` — direct-write.
 *
 * Inserts an `app.meal` row. Replaces the M3.5-A draft-write stub now
 * that the planner UI + approval-less write path are both live. Member
 * must hold `food:write`.
 */

import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../../types.js';

const inputSchema = z.object({
  /** ISO date (YYYY-MM-DD). */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  dish: z.string().min(1).max(200),
  servings: z.number().int().positive().optional(),
  dish_node_id: z.string().uuid().optional(),
  cook_member_id: z.string().uuid().optional(),
  notes: z.string().max(1_000).optional(),
});

const outputSchema = z.object({
  meal_id: z.string(),
  status: z.literal('planned'),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const addMealToPlanTool: ToolDefinition<Input, Output> = {
  name: 'add_meal_to_plan',
  description: 'Add a planned meal on a date + slot. Writes directly to app.meal.',
  class: 'direct-write',
  input: inputSchema,
  output: outputSchema,
  segments: ['food'],
  async handler(args, ctx) {
    const { data, error } = await ctx.supabase
      .schema('app')
      .from('meal')
      .insert({
        household_id: ctx.householdId,
        planned_for: args.date,
        slot: args.slot,
        title: args.dish,
        ...(args.servings !== undefined ? { servings: args.servings } : {}),
        ...(args.dish_node_id ? { dish_node_id: args.dish_node_id } : {}),
        ...(args.cook_member_id ? { cook_member_id: args.cook_member_id } : {}),
        ...(args.notes ? { notes: args.notes } : {}),
        status: 'planned',
      })
      .select('id')
      .single();
    if (error) throw new ToolError('db_error', `add_meal_to_plan insert: ${error.message}`);
    ctx.log.info('add_meal_to_plan inserted', {
      household_id: ctx.householdId,
      meal_id: data.id,
      slot: args.slot,
      date: args.date,
    });
    return { meal_id: data.id as string, status: 'planned' };
  },
};
