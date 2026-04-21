/**
 * `listFinancialSummaries` — server-side reader for `app.summary` rows in
 * the Financial segment.
 *
 * Powers `/financial/summaries` and seeds the Financial dashboard's
 * MTD-spend headline (latest summary carries deterministic metrics in the
 * body). Ordered by `covered_start desc`, limit 12 by default.
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import { hasFinancialRead, type SegmentGrant } from './listTransactions';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';

export const listFinancialSummariesArgsSchema = z.object({
  householdId: z.string().uuid(),
  limit: z.number().int().positive().max(60).optional(),
});

export type ListFinancialSummariesArgs = z.infer<typeof listFinancialSummariesArgsSchema>;

export interface FinancialSummaryRow {
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

function toCamel(row: SummaryRowDb): FinancialSummaryRow {
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

export interface ListFinancialSummariesDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
}

export async function listFinancialSummaries(
  args: ListFinancialSummariesArgs,
  deps: ListFinancialSummariesDeps = {},
): Promise<FinancialSummaryRow[]> {
  const parsed = listFinancialSummariesArgsSchema.parse(args);

  if (deps.grants && !hasFinancialRead(deps.grants)) {
    return [];
  }

  const client = deps.client ?? (await createClient());
  const { data, error } = await client
    .schema('app')
    .from('summary')
    .select(
      'id, household_id, segment, period, covered_start, covered_end, generated_at, model, body_md',
    )
    .eq('household_id', parsed.householdId)
    .eq('segment', 'financial')
    .order('covered_start', { ascending: false })
    .limit(parsed.limit ?? 12);

  if (error) throw new Error(`listFinancialSummaries: ${error.message}`);
  return (data ?? []).map((row) => toCamel(row as SummaryRowDb));
}
