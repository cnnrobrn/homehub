/**
 * `listFinancialSuggestions` — pending suggestions for the Financial
 * segment dashboard. Reads `app.suggestion where segment='financial' and
 * status='pending'`.
 *
 * The approval flow (Approve/Reject) lands with M9; for M5-C we only
 * surface the pending queue and render it as read-only cards.
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { hasFinancialRead, type SegmentGrant } from './listTransactions';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';

export const listFinancialSuggestionsArgsSchema = z.object({
  householdId: z.string().uuid(),
  limit: z.number().int().positive().max(50).optional(),
});

export type ListFinancialSuggestionsArgs = z.infer<typeof listFinancialSuggestionsArgsSchema>;

export interface FinancialSuggestionRow {
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

function toCamel(row: SuggestionRowDb): FinancialSuggestionRow {
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

export interface ListFinancialSuggestionsDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
}

export async function listFinancialSuggestions(
  args: ListFinancialSuggestionsArgs,
  deps: ListFinancialSuggestionsDeps = {},
): Promise<FinancialSuggestionRow[]> {
  const parsed = listFinancialSuggestionsArgsSchema.parse(args);

  if (deps.grants && !hasFinancialRead(deps.grants)) {
    return [];
  }

  const client = deps.client ?? (await createClient());
  const { data, error } = await client
    .schema('app')
    .from('suggestion')
    .select('id, household_id, kind, title, rationale, status, created_at, preview')
    .eq('household_id', parsed.householdId)
    .eq('segment', 'financial')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(parsed.limit ?? 10);

  if (error) throw new Error(`listFinancialSuggestions: ${error.message}`);
  return (data ?? []).map((row) => toCamel(row as SuggestionRowDb));
}
