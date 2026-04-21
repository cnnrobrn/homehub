/**
 * `listGroceryLists` — server-side reader for `app.grocery_list` rows +
 * their items.
 *
 * Returns the 20 most-recent lists with nested items. Defaults to all
 * statuses; callers filter via `statuses`.
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { GROCERY_STATUSES, hasFoodRead, type GroceryStatus, type SegmentGrant } from './types';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';

export const listGroceryListsArgsSchema = z.object({
  householdId: z.string().uuid(),
  statuses: z.array(z.enum(GROCERY_STATUSES)).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export type ListGroceryListsArgs = z.infer<typeof listGroceryListsArgsSchema>;

export interface GroceryListItemRow {
  id: string;
  listId: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  sourceMealId: string | null;
  checked: boolean;
}

export interface GroceryListRow {
  id: string;
  householdId: string;
  plannedFor: string | null;
  status: GroceryStatus;
  provider: string | null;
  externalOrderId: string | null;
  createdAt: string;
  updatedAt: string;
  items: GroceryListItemRow[];
}

type ListRowDb = Database['app']['Tables']['grocery_list']['Row'];
type ItemRowDb = Database['app']['Tables']['grocery_list_item']['Row'];

export interface ListGroceryListsDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
}

export async function listGroceryLists(
  args: ListGroceryListsArgs,
  deps: ListGroceryListsDeps = {},
): Promise<GroceryListRow[]> {
  const parsed = listGroceryListsArgsSchema.parse(args);
  if (deps.grants && !hasFoodRead(deps.grants)) return [];
  const client = deps.client ?? (await createClient());

  let query = client
    .schema('app')
    .from('grocery_list')
    .select(
      'id, household_id, planned_for, status, provider, external_order_id, created_at, updated_at',
    )
    .eq('household_id', parsed.householdId);
  if (parsed.statuses && parsed.statuses.length > 0) {
    query = query.in('status', parsed.statuses);
  }
  query = query.order('updated_at', { ascending: false }).limit(parsed.limit ?? 20);
  const { data: lists, error } = await query;
  if (error) throw new Error(`listGroceryLists: ${error.message}`);
  const rows = (lists ?? []) as ListRowDb[];
  if (rows.length === 0) return [];

  const listIds = rows.map((r) => r.id);
  const { data: items, error: itemErr } = await client
    .schema('app')
    .from('grocery_list_item')
    .select('id, list_id, name, quantity, unit, source_meal_id, checked')
    .eq('household_id', parsed.householdId)
    .in('list_id', listIds);
  if (itemErr) throw new Error(`listGroceryLists items: ${itemErr.message}`);

  const itemsByList = new Map<string, GroceryListItemRow[]>();
  for (const row of (items ?? []) as ItemRowDb[]) {
    const bucket = itemsByList.get(row.list_id) ?? [];
    bucket.push({
      id: row.id,
      listId: row.list_id,
      name: row.name,
      quantity: row.quantity === null ? null : Number(row.quantity),
      unit: row.unit ?? null,
      sourceMealId: row.source_meal_id ?? null,
      checked: row.checked,
    });
    itemsByList.set(row.list_id, bucket);
  }

  return rows.map((r) => ({
    id: r.id,
    householdId: r.household_id,
    plannedFor: r.planned_for ?? null,
    status: r.status as GroceryStatus,
    provider: r.provider ?? null,
    externalOrderId: r.external_order_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    items: itemsByList.get(r.id) ?? [],
  }));
}
