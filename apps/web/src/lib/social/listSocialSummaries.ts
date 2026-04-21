/**
 * `listSocialSummaries` — `app.summary` rows for the social segment.
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { hasSocialRead, type SegmentGrant, type SocialSummaryRow } from './types';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';


export const listSocialSummariesArgsSchema = z.object({
  householdId: z.string().uuid(),
  limit: z.number().int().positive().max(60).optional(),
});

export type ListSocialSummariesArgs = z.infer<typeof listSocialSummariesArgsSchema>;

type SummaryRowDb = Database['app']['Tables']['summary']['Row'];

function toCamel(row: SummaryRowDb): SocialSummaryRow {
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

export interface ListSocialSummariesDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
}

export async function listSocialSummaries(
  args: ListSocialSummariesArgs,
  deps: ListSocialSummariesDeps = {},
): Promise<SocialSummaryRow[]> {
  const parsed = listSocialSummariesArgsSchema.parse(args);
  if (deps.grants && !hasSocialRead(deps.grants)) return [];

  const client = deps.client ?? (await createClient());
  const { data, error } = await client
    .schema('app')
    .from('summary')
    .select(
      'id, household_id, segment, period, covered_start, covered_end, generated_at, model, body_md',
    )
    .eq('household_id', parsed.householdId)
    .eq('segment', 'social')
    .order('covered_start', { ascending: false })
    .limit(parsed.limit ?? 12);

  if (error) throw new Error(`listSocialSummaries: ${error.message}`);
  return (data ?? []).map((r) => toCamel(r as SummaryRowDb));
}
