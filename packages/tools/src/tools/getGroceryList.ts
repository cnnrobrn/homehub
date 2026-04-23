/**
 * `get_grocery_list` — latest `app.grocery_list` row for the household
 * plus its items.
 *
 * Requires `food:read`. Defaults to the most recent draft; pass
 * `status` to select the latest `placed` / `completed` list instead.
 */

import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../types.js';

interface ListRow {
  id: string;
  status: string;
  planned_for: string | null;
  provider: string | null;
  external_order_id: string | null;
  external_url: string | null;
  created_at: string;
  updated_at: string;
}

interface ItemRow {
  id: string;
  list_id: string;
  name: string;
  quantity: number | null;
  checked: boolean;
}

const inputSchema = z.object({
  status: z.string().optional(),
});

const outputSchema = z.object({
  list: z
    .object({
      id: z.string(),
      status: z.string(),
      planned_for: z.string().nullable(),
      provider: z.string().nullable(),
      external_order_id: z.string().nullable(),
      external_url: z.string().nullable(),
      created_at: z.string(),
      updated_at: z.string(),
    })
    .nullable(),
  items: z.array(
    z.object({
      id: z.string(),
      list_id: z.string(),
      name: z.string(),
      quantity: z.number().nullable(),
      checked: z.boolean(),
    }),
  ),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const getGroceryListTool: ToolDefinition<Input, Output> = {
  name: 'get_grocery_list',
  description: 'Latest grocery list for the household (draft by default) and its items.',
  class: 'read',
  input: inputSchema,
  output: outputSchema,
  segments: ['food'],
  async handler(args, ctx) {
    let listQ = ctx.supabase
      .schema('app')
      .from('grocery_list')
      .select(
        'id, status, planned_for, provider, external_order_id, external_url, created_at, updated_at',
      )
      .eq('household_id', ctx.householdId);
    if (args.status) {
      listQ = listQ.eq('status', args.status);
    }
    const { data: listData, error: listErr } = await listQ
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (listErr) throw new ToolError('db_error', `get_grocery_list: ${listErr.message}`);
    if (!listData) return { list: null, items: [] };
    const list = listData as ListRow;

    const { data: items, error: itemsErr } = await ctx.supabase
      .schema('app')
      .from('grocery_list_item')
      .select('id, list_id, name, quantity, checked')
      .eq('household_id', ctx.householdId)
      .eq('list_id', list.id)
      .order('name', { ascending: true });
    if (itemsErr) throw new ToolError('db_error', `get_grocery_list items: ${itemsErr.message}`);
    return {
      list: {
        id: list.id,
        status: list.status,
        planned_for: list.planned_for,
        provider: list.provider,
        external_order_id: list.external_order_id,
        external_url: list.external_url,
        created_at: list.created_at,
        updated_at: list.updated_at,
      },
      items: (items ?? []).map((i: ItemRow) => ({
        id: i.id,
        list_id: i.list_id,
        name: i.name,
        quantity: i.quantity,
        checked: i.checked,
      })),
    };
  },
};
