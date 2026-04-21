/**
 * `update_pantry_item` — direct-write.
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../../types.js';

type PantryItemUpdate = Database['app']['Tables']['pantry_item']['Update'];

const inputSchema = z.object({
  pantry_item_id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  quantity: z.number().positive().nullable().optional(),
  unit: z.string().max(40).nullable().optional(),
  expires_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  location: z.enum(['fridge', 'freezer', 'pantry']).nullable().optional(),
});

const outputSchema = z.object({
  pantry_item_id: z.string(),
  updated_fields: z.array(z.string()),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const updatePantryItemTool: ToolDefinition<Input, Output> = {
  name: 'update_pantry_item',
  description: 'Update fields on an existing pantry item (quantity, expires_on, etc).',
  class: 'direct-write',
  input: inputSchema,
  output: outputSchema,
  segments: ['food'],
  async handler(args, ctx) {
    const patch: PantryItemUpdate = {};
    const updated: string[] = [];
    if (args.name !== undefined) {
      patch.name = args.name;
      updated.push('name');
    }
    if (args.quantity !== undefined) {
      patch.quantity = args.quantity;
      updated.push('quantity');
    }
    if (args.unit !== undefined) {
      patch.unit = args.unit;
      updated.push('unit');
    }
    if (args.expires_on !== undefined) {
      patch.expires_on = args.expires_on;
      updated.push('expires_on');
    }
    if (args.location !== undefined) {
      patch.location = args.location;
      updated.push('location');
    }
    if (updated.length === 0) {
      throw new ToolError('invalid_patch', 'update_pantry_item requires at least one field');
    }
    patch.updated_at = new Date().toISOString();
    patch.last_seen_at = new Date().toISOString();

    const { error } = await ctx.supabase
      .schema('app')
      .from('pantry_item')
      .update(patch)
      .eq('household_id', ctx.householdId)
      .eq('id', args.pantry_item_id);
    if (error) throw new ToolError('db_error', `update_pantry_item: ${error.message}`);

    return { pantry_item_id: args.pantry_item_id, updated_fields: updated };
  },
};
