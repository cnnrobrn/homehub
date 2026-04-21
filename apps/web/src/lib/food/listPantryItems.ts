/**
 * `listPantryItems` — server-side reader for `app.pantry_item`.
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { hasFoodRead, type PantryLocation, type SegmentGrant } from './types';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';

export const listPantryItemsArgsSchema = z.object({
  householdId: z.string().uuid(),
  location: z.enum(['fridge', 'freezer', 'pantry']).optional(),
  expiringWithinDays: z.number().int().min(0).max(365).optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export type ListPantryItemsArgs = z.infer<typeof listPantryItemsArgsSchema>;

export interface PantryItemRow {
  id: string;
  householdId: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  expiresOn: string | null;
  location: PantryLocation | null;
  lastSeenAt: string | null;
}

type PantryItemRowDb = Database['app']['Tables']['pantry_item']['Row'];

function toCamel(row: PantryItemRowDb): PantryItemRow {
  return {
    id: row.id,
    householdId: row.household_id,
    name: row.name,
    quantity: row.quantity === null ? null : Number(row.quantity),
    unit: row.unit ?? null,
    expiresOn: row.expires_on ?? null,
    location: (row.location as PantryLocation | null) ?? null,
    lastSeenAt: row.last_seen_at ?? null,
  };
}

export interface ListPantryItemsDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
}

export async function listPantryItems(
  args: ListPantryItemsArgs,
  deps: ListPantryItemsDeps = {},
): Promise<PantryItemRow[]> {
  const parsed = listPantryItemsArgsSchema.parse(args);
  if (deps.grants && !hasFoodRead(deps.grants)) return [];

  const client = deps.client ?? (await createClient());
  let query = client
    .schema('app')
    .from('pantry_item')
    .select('id, household_id, name, quantity, unit, expires_on, location, last_seen_at')
    .eq('household_id', parsed.householdId);
  if (parsed.location) query = query.eq('location', parsed.location);
  if (parsed.expiringWithinDays !== undefined) {
    const horizon = new Date(Date.now() + parsed.expiringWithinDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    query = query.lte('expires_on', horizon);
  }
  query = query.order('expires_on', { ascending: true }).limit(parsed.limit ?? 300);
  const { data, error } = await query;
  if (error) throw new Error(`listPantryItems: ${error.message}`);
  return (data ?? []).map((r) => toCamel(r as PantryItemRowDb));
}
