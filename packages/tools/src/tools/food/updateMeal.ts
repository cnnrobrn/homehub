/**
 * `update_meal` — direct-write.
 *
 * Updates mutable fields on an `app.meal` row. Only fields the caller
 * supplies are written; the handler explicitly rejects empty payloads
 * so a stray call can't silently bump `updated_at`.
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../../types.js';

type MealUpdate = Database['app']['Tables']['meal']['Update'];

const inputSchema = z.object({
  meal_id: z.string().uuid(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  slot: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
  dish: z.string().min(1).max(200).optional(),
  status: z.enum(['planned', 'cooking', 'served', 'skipped']).optional(),
  servings: z.number().int().positive().optional(),
  dish_node_id: z.string().uuid().nullable().optional(),
  cook_member_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(1_000).nullable().optional(),
});

const outputSchema = z.object({
  meal_id: z.string(),
  updated_fields: z.array(z.string()),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const updateMealTool: ToolDefinition<Input, Output> = {
  name: 'update_meal',
  description: 'Update an existing planned meal (slot, dish, status, servings, etc).',
  class: 'direct-write',
  input: inputSchema,
  output: outputSchema,
  segments: ['food'],
  async handler(args, ctx) {
    const patch: MealUpdate = {};
    const updated: string[] = [];
    if (args.date !== undefined) {
      patch.planned_for = args.date;
      updated.push('planned_for');
    }
    if (args.slot !== undefined) {
      patch.slot = args.slot;
      updated.push('slot');
    }
    if (args.dish !== undefined) {
      patch.title = args.dish;
      updated.push('title');
    }
    if (args.status !== undefined) {
      patch.status = args.status;
      updated.push('status');
    }
    if (args.servings !== undefined) {
      patch.servings = args.servings;
      updated.push('servings');
    }
    if (args.dish_node_id !== undefined) {
      patch.dish_node_id = args.dish_node_id;
      updated.push('dish_node_id');
    }
    if (args.cook_member_id !== undefined) {
      patch.cook_member_id = args.cook_member_id;
      updated.push('cook_member_id');
    }
    if (args.notes !== undefined) {
      patch.notes = args.notes;
      updated.push('notes');
    }
    if (updated.length === 0) {
      throw new ToolError('invalid_patch', 'update_meal requires at least one field');
    }
    patch.updated_at = new Date().toISOString();

    const { error } = await ctx.supabase
      .schema('app')
      .from('meal')
      .update(patch)
      .eq('household_id', ctx.householdId)
      .eq('id', args.meal_id);
    if (error) throw new ToolError('db_error', `update_meal: ${error.message}`);

    ctx.log.info('update_meal applied', {
      household_id: ctx.householdId,
      meal_id: args.meal_id,
      fields: updated,
    });
    return { meal_id: args.meal_id, updated_fields: updated };
  },
};
