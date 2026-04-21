/**
 * `remove_meal` — direct-write.
 *
 * Deletes a planned meal by id. RLS + the explicit household filter
 * keep the call household-scoped even if the agent loop mis-routes ids.
 */

import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../../types.js';

const inputSchema = z.object({
  meal_id: z.string().uuid(),
});

const outputSchema = z.object({
  meal_id: z.string(),
  deleted: z.boolean(),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const removeMealTool: ToolDefinition<Input, Output> = {
  name: 'remove_meal',
  description: 'Delete a planned meal by id.',
  class: 'direct-write',
  input: inputSchema,
  output: outputSchema,
  segments: ['food'],
  async handler(args, ctx) {
    const { error } = await ctx.supabase
      .schema('app')
      .from('meal')
      .delete()
      .eq('household_id', ctx.householdId)
      .eq('id', args.meal_id);
    if (error) throw new ToolError('db_error', `remove_meal: ${error.message}`);
    ctx.log.info('remove_meal applied', {
      household_id: ctx.householdId,
      meal_id: args.meal_id,
    });
    return { meal_id: args.meal_id, deleted: true };
  },
};
