/**
 * `add_pantry_item` — direct-write.
 *
 * Inserts an `app.pantry_item` row. The canonical "add something to the
 * pantry" path from the agent loop + the UI form.
 */

import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../../types.js';

const inputSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: z.number().positive().optional(),
  unit: z.string().max(40).optional(),
  expires_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  location: z.enum(['fridge', 'freezer', 'pantry']).optional(),
});

const outputSchema = z.object({
  pantry_item_id: z.string(),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const addPantryItemTool: ToolDefinition<Input, Output> = {
  name: 'add_pantry_item',
  description: 'Add an item to the pantry inventory.',
  class: 'direct-write',
  input: inputSchema,
  output: outputSchema,
  segments: ['food'],
  async handler(args, ctx) {
    const { data, error } = await ctx.supabase
      .schema('app')
      .from('pantry_item')
      .insert({
        household_id: ctx.householdId,
        name: args.name,
        ...(args.quantity !== undefined ? { quantity: args.quantity } : {}),
        ...(args.unit ? { unit: args.unit } : {}),
        ...(args.expires_on ? { expires_on: args.expires_on } : {}),
        ...(args.location ? { location: args.location } : {}),
        last_seen_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (error) throw new ToolError('db_error', `add_pantry_item: ${error.message}`);
    ctx.log.info('add_pantry_item inserted', {
      household_id: ctx.householdId,
      pantry_item_id: data.id,
      name: args.name,
    });
    return { pantry_item_id: data.id as string };
  },
};
