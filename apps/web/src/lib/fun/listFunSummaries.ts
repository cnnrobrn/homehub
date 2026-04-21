/**
 * `listFunSummaries` — server-side reader for `app.summary` rows in the
 * Fun segment.
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { hasFunRead, type SegmentGrant } from './segmentGrants';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';

export const listFunSummariesArgsSchema = z.object({
  householdId: z.string().uuid(),
  limit: z.number().int().positive().max(60).optional(),
});

export type ListFunSummariesArgs = z.infer<typeof listFunSummariesArgsSchema>;

export interface FunSummaryRow {
  id: string;
  householdId: string;
  segment: string;
  period: string;
  coveredStart: string;
  coveredEnd: string;
  generatedAt: string;
  model: string;
  bodyMd: string;
}

type SummaryRowDb = Database['app']['Tables']['summary']['Row'];

function toCamel(row: SummaryRowDb): FunSummaryRow {
  return {
    id: row.id,
    householdId: row.household_id,
    segment: row.segment,
    period: row.period,
    coveredStart: row.covered_start,
    coveredEnd: row.covered_end,
    generatedAt: row.generated_at,
    model: row.model,
    bodyMd: row.body_md,
  };
}

export interface ListFunSummariesDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
}

export async function listFunSummaries(
  args: ListFunSummariesArgs,
  deps: ListFunSummariesDeps = {},
): Promise<FunSummaryRow[]> {
  const parsed = listFunSummariesArgsSchema.parse(args);
  if (deps.grants && !hasFunRead(deps.grants)) return [];

  const client = deps.client ?? (await createClient());
  const { data, error } = await client
    .schema('app')
    .from('summary')
    .select(
      'id, household_id, segment, period, covered_start, covered_end, generated_at, model, body_md',
    )
    .eq('household_id', parsed.householdId)
    .eq('segment', 'fun')
    .order('covered_start', { ascending: false })
    .limit(parsed.limit ?? 12);

  if (error) throw new Error(`listFunSummaries: ${error.message}`);
  return (data ?? []).map((row) => toCamel(row as SummaryRowDb));
}
