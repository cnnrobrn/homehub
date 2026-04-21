/**
 * `remove_pantry_item` — direct-write.
 */

import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../../types.js';

const inputSchema = z.object({
  pantry_item_id: z.string().uuid(),
});

const outputSchema = z.object({
  pantry_item_id: z.string(),
  deleted: z.boolean(),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const removePantryItemTool: ToolDefinition<Input, Output> = {
  name: 'remove_pantry_item',
  description: 'Delete a pantry item by id.',
  class: 'direct-write',
  input: inputSchema,
  output: outputSchema,
  segments: ['food'],
  async handler(args, ctx) {
    const { error } = await ctx.supabase
      .schema('app')
      .from('pantry_item')
      .delete()
      .eq('household_id', ctx.householdId)
      .eq('id', args.pantry_item_id);
    if (error) throw new ToolError('db_error', `remove_pantry_item: ${error.message}`);
    return { pantry_item_id: args.pantry_item_id, deleted: true };
  },
};
