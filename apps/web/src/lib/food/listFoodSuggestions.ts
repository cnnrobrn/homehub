/**
 * `listFoodSuggestions` — pending suggestions for the food segment.
 *
 * Mirrors the financial-segment helper. Renders on
 * `/food` (dashboard) + `/food/groceries` (approve/reject surface).
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { hasFoodRead, type SegmentGrant } from './types';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';

export const listFoodSuggestionsArgsSchema = z.object({
  householdId: z.string().uuid(),
  kinds: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(50).optional(),
});

export type ListFoodSuggestionsArgs = z.infer<typeof listFoodSuggestionsArgsSchema>;

export interface FoodSuggestionRow {
  id: string;
  householdId: string;
  kind: string;
  title: string;
  rationale: string;
  status: string;
  createdAt: string;
  preview: Record<string, unknown>;
}

type SuggestionRowDb = Database['app']['Tables']['suggestion']['Row'];

function toCamel(row: SuggestionRowDb): FoodSuggestionRow {
  const rawPreview = row.preview;
  const preview =
    rawPreview !== null && typeof rawPreview === 'object' && !Array.isArray(rawPreview)
      ? (rawPreview as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    householdId: row.household_id,
    kind: row.kind,
    title: row.title,
    rationale: row.rationale,
    status: row.status,
    createdAt: row.created_at,
    preview,
  };
}

export interface ListFoodSuggestionsDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
}

export async function listFoodSuggestions(
  args: ListFoodSuggestionsArgs,
  deps: ListFoodSuggestionsDeps = {},
): Promise<FoodSuggestionRow[]> {
  const parsed = listFoodSuggestionsArgsSchema.parse(args);
  if (deps.grants && !hasFoodRead(deps.grants)) return [];
  const client = deps.client ?? (await createClient());
  let query = client
    .schema('app')
    .from('suggestion')
    .select('id, household_id, kind, title, rationale, status, created_at, preview')
    .eq('household_id', parsed.householdId)
    .eq('segment', 'food')
    .eq('status', 'pending');
  if (parsed.kinds && parsed.kinds.length > 0) {
    query = query.in('kind', parsed.kinds);
  }
  query = query.order('created_at', { ascending: false }).limit(parsed.limit ?? 20);
  const { data, error } = await query;
  if (error) throw new Error(`listFoodSuggestions: ${error.message}`);
  return (data ?? []).map((r) => toCamel(r as SuggestionRowDb));
}
