/**
 * `propose_grocery_order` — draft-write.
 *
 * Writes `app.suggestion kind='propose_grocery_order'` with a preview
 * payload the UI renders as an approval card. M9 turns an approval into
 * a real grocery-list + provider draft-order call.
 *
 * The agent passes `items` (what to include) and an optional
 * `provider` — if absent, the stub provider is used on approval.
 */

import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../../types.js';

const inputSchema = z.object({
  planned_for: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  provider: z.string().optional(),
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        quantity: z.number().positive().optional(),
        unit: z.string().max(40).optional(),
      }),
    )
    .min(1),
});

const outputSchema = z.object({
  status: z.literal('pending_approval'),
  suggestion_id: z.string(),
  preview: z.object({
    planned_for: z.string(),
    provider: z.string().nullable(),
    items: z.array(
      z.object({
        name: z.string(),
        quantity: z.number().nullable(),
        unit: z.string().nullable(),
      }),
    ),
  }),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const proposeGroceryOrderTool: ToolDefinition<Input, Output> = {
  name: 'propose_grocery_order',
  description:
    'Propose a grocery order with explicit items. Writes an app.suggestion row the member approves; M9 executes the approved draft against the grocery provider.',
  class: 'draft-write',
  input: inputSchema,
  output: outputSchema,
  segments: ['food'],
  async handler(args, ctx) {
    const normalizedItems = args.items.map((i) => ({
      name: i.name,
      quantity: i.quantity ?? null,
      unit: i.unit ?? null,
    }));

    const preview = {
      planned_for: args.planned_for,
      provider: args.provider ?? null,
      items: normalizedItems,
    };

    const { data: inserted, error } = await ctx.supabase
      .schema('app')
      .from('suggestion')
      .insert({
        household_id: ctx.householdId,
        segment: 'food',
        kind: 'propose_grocery_order',
        title: `Grocery order for ${args.planned_for} (${normalizedItems.length} item${normalizedItems.length === 1 ? '' : 's'})`,
        rationale: `Draft grocery order with ${normalizedItems.length} item${normalizedItems.length === 1 ? '' : 's'}, pending member approval.`,
        preview: preview as never,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error) throw new ToolError('db_error', `propose_grocery_order insert: ${error.message}`);

    ctx.log.info('propose_grocery_order suggestion created', {
      household_id: ctx.householdId,
      suggestion_id: inserted.id,
      item_count: normalizedItems.length,
    });

    return {
      status: 'pending_approval',
      suggestion_id: inserted.id as string,
      preview,
    };
  },
};
