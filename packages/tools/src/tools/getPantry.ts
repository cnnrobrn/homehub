/**
 * `get_pantry` — current `app.pantry_item` for the household.
 *
 * Requires `food:read`. No time filter; pantry is a live snapshot.
 */

import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../types.js';

interface PantryRow {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  location: string | null;
  expires_on: string | null;
  last_seen_at: string | null;
}

const inputSchema = z.object({
  location: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

const itemSchema = z.object({
  id: z.string(),
  name: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  location: z.string().nullable(),
  expires_on: z.string().nullable(),
  last_seen_at: z.string().nullable(),
});

const outputSchema = z.object({ items: z.array(itemSchema) });

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const getPantryTool: ToolDefinition<Input, Output> = {
  name: 'get_pantry',
  description: 'Current pantry inventory for the household.',
  class: 'read',
  input: inputSchema,
  output: outputSchema,
  segments: ['food'],
  async handler(args, ctx) {
    let q = ctx.supabase
      .schema('app')
      .from('pantry_item')
      .select('id, name, quantity, unit, location, expires_on, last_seen_at')
      .eq('household_id', ctx.householdId);
    if (args.location) q = q.eq('location', args.location);
    q = q.order('name', { ascending: true }).limit(args.limit ?? 200);
    const { data, error } = await q;
    if (error) throw new ToolError('db_error', `get_pantry: ${error.message}`);
    return {
      items: (data ?? []).map((p: PantryRow) => ({
        id: p.id,
        name: p.name,
        quantity: p.quantity,
        unit: p.unit,
        location: p.location,
        expires_on: p.expires_on,
        last_seen_at: p.last_seen_at,
      })),
    };
  },
};
