/**
 * `listSocialSuggestions` — pending social suggestions for the
 * dashboard/list surfaces.
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { hasSocialRead, type SegmentGrant, type SocialSuggestionRow } from './types';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';


export const listSocialSuggestionsArgsSchema = z.object({
  householdId: z.string().uuid(),
  personNodeId: z.string().uuid().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export type ListSocialSuggestionsArgs = z.infer<typeof listSocialSuggestionsArgsSchema>;

type SuggestionRowDb = Database['app']['Tables']['suggestion']['Row'];

function toCamel(row: SuggestionRowDb): SocialSuggestionRow {
  const preview =
    row.preview !== null && typeof row.preview === 'object' && !Array.isArray(row.preview)
      ? (row.preview as Record<string, unknown>)
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

export interface ListSocialSuggestionsDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
}

export async function listSocialSuggestions(
  args: ListSocialSuggestionsArgs,
  deps: ListSocialSuggestionsDeps = {},
): Promise<SocialSuggestionRow[]> {
  const parsed = listSocialSuggestionsArgsSchema.parse(args);
  if (deps.grants && !hasSocialRead(deps.grants)) return [];

  const client = deps.client ?? (await createClient());
  const { data, error } = await client
    .schema('app')
    .from('suggestion')
    .select('id, household_id, kind, title, rationale, status, created_at, preview')
    .eq('household_id', parsed.householdId)
    .eq('segment', 'social')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(parsed.limit ?? 20);

  if (error) throw new Error(`listSocialSuggestions: ${error.message}`);
  let rows = (data ?? []).map((r) => toCamel(r as SuggestionRowDb));
  if (parsed.personNodeId) {
    rows = rows.filter((r) => r.preview['person_node_id'] === parsed.personNodeId);
  }
  return rows;
}
