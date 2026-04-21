/**
 * `listDishes` — server-side reader for `mem.node type='dish'`.
 *
 * Powers `/food/dishes`. The dish library is the agent's source of
 * truth for meal planning, so we expose it as a first-class surface
 * even though it lives on the memory graph.
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { hasFoodRead, type SegmentGrant } from './types';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';

export const listDishesArgsSchema = z.object({
  householdId: z.string().uuid(),
  searchText: z.string().min(1).max(200).optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export type ListDishesArgs = z.infer<typeof listDishesArgsSchema>;

export interface DishRow {
  id: string;
  householdId: string;
  canonicalName: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  needsReview: boolean;
}

type NodeRowDb = Database['mem']['Tables']['node']['Row'];

function toCamel(row: NodeRowDb): DishRow {
  const metaRaw = row.metadata;
  const metadata =
    metaRaw !== null && typeof metaRaw === 'object' && !Array.isArray(metaRaw)
      ? (metaRaw as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    householdId: row.household_id,
    canonicalName: row.canonical_name,
    metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    needsReview: Boolean(row.needs_review),
  };
}

export interface ListDishesDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
}

export async function listDishes(
  args: ListDishesArgs,
  deps: ListDishesDeps = {},
): Promise<DishRow[]> {
  const parsed = listDishesArgsSchema.parse(args);
  if (deps.grants && !hasFoodRead(deps.grants)) return [];
  const client = deps.client ?? (await createClient());
  let query = client
    .schema('mem')
    .from('node')
    .select(
      'id, household_id, type, canonical_name, metadata, created_at, updated_at, needs_review',
    )
    .eq('household_id', parsed.householdId)
    .eq('type', 'dish');
  if (parsed.searchText) {
    const like = `%${parsed.searchText.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    query = query.ilike('canonical_name', like);
  }
  query = query.order('canonical_name', { ascending: true }).limit(parsed.limit ?? 200);
  const { data, error } = await query;
  if (error) throw new Error(`listDishes: ${error.message}`);
  return (data ?? []).map((r) => toCamel(r as NodeRowDb));
}
