/**
 * `listFoodSummaries` — server-side reader for `app.summary where segment='food'`.
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { hasFoodRead, type SegmentGrant } from './types';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';

export const listFoodSummariesArgsSchema = z.object({
  householdId: z.string().uuid(),
  limit: z.number().int().positive().max(60).optional(),
});

export type ListFoodSummariesArgs = z.infer<typeof listFoodSummariesArgsSchema>;

export interface FoodSummaryRow {
  id: string;
  householdId: string;
  period: string;
  coveredStart: string;
  coveredEnd: string;
  generatedAt: string;
  model: string;
  bodyMd: string;
}

type SummaryRowDb = Database['app']['Tables']['summary']['Row'];

function toCamel(row: SummaryRowDb): FoodSummaryRow {
  return {
    id: row.id,
    householdId: row.household_id,
    period: row.period,
    coveredStart: row.covered_start,
    coveredEnd: row.covered_end,
    generatedAt: row.generated_at,
    model: row.model,
    bodyMd: row.body_md,
  };
}

export interface ListFoodSummariesDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
}

export async function listFoodSummaries(
  args: ListFoodSummariesArgs,
  deps: ListFoodSummariesDeps = {},
): Promise<FoodSummaryRow[]> {
  const parsed = listFoodSummariesArgsSchema.parse(args);
  if (deps.grants && !hasFoodRead(deps.grants)) return [];
  const client = deps.client ?? (await createClient());
  const { data, error } = await client
    .schema('app')
    .from('summary')
    .select(
      'id, household_id, segment, period, covered_start, covered_end, generated_at, model, body_md',
    )
    .eq('household_id', parsed.householdId)
    .eq('segment', 'food')
    .order('covered_start', { ascending: false })
    .limit(parsed.limit ?? 12);
  if (error) throw new Error(`listFoodSummaries: ${error.message}`);
  return (data ?? []).map((r) => toCamel(r as SummaryRowDb));
}
