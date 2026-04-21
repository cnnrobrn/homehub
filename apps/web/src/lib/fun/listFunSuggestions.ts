/**
 * `listFunSuggestions` — pending suggestions for the Fun segment.
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { hasFunRead, type SegmentGrant } from './segmentGrants';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';

export const listFunSuggestionsArgsSchema = z.object({
  householdId: z.string().uuid(),
  kinds: z.array(z.string().min(1).max(60)).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export type ListFunSuggestionsArgs = z.infer<typeof listFunSuggestionsArgsSchema>;

export interface FunSuggestionRow {
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

function toCamel(row: SuggestionRowDb): FunSuggestionRow {
  const previewRaw = row.preview;
  const preview =
    previewRaw !== null && typeof previewRaw === 'object' && !Array.isArray(previewRaw)
      ? (previewRaw as Record<string, unknown>)
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

export interface ListFunSuggestionsDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
}

export async function listFunSuggestions(
  args: ListFunSuggestionsArgs,
  deps: ListFunSuggestionsDeps = {},
): Promise<FunSuggestionRow[]> {
  const parsed = listFunSuggestionsArgsSchema.parse(args);
  if (deps.grants && !hasFunRead(deps.grants)) return [];

  const client = deps.client ?? (await createClient());
  let query = client
    .schema('app')
    .from('suggestion')
    .select('id, household_id, kind, title, rationale, status, created_at, preview')
    .eq('household_id', parsed.householdId)
    .eq('segment', 'fun')
    .eq('status', 'pending');
  if (parsed.kinds && parsed.kinds.length > 0) {
    query = query.in('kind', parsed.kinds);
  }
  query = query.order('created_at', { ascending: false }).limit(parsed.limit ?? 20);

  const { data, error } = await query;
  if (error) throw new Error(`listFunSuggestions: ${error.message}`);
  return (data ?? []).map((row) => toCamel(row as SuggestionRowDb));
}
