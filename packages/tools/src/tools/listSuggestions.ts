/**
 * `list_suggestions` — pending `app.suggestion` rows for the household.
 *
 * `segments: 'all'` because suggestions are cross-segment; the per-row
 * `segment` field is returned so the model can filter client-side.
 */

import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../types.js';

import type { Database } from '@homehub/db';

type Json = Database['app']['Tables']['suggestion']['Row']['preview'];

interface SuggestionRow {
  id: string;
  segment: string;
  kind: string;
  title: string;
  rationale: string;
  status: string;
  created_at: string;
  preview: Json;
}

const inputSchema = z.object({
  segment: z.enum(['financial', 'food', 'fun', 'social', 'system']).optional(),
  status: z.enum(['pending', 'accepted', 'rejected', 'expired']).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const outputSchema = z.object({
  suggestions: z.array(
    z.object({
      id: z.string(),
      segment: z.string(),
      kind: z.string(),
      title: z.string(),
      rationale: z.string(),
      status: z.string(),
      created_at: z.string(),
      preview: z.unknown(),
    }),
  ),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const listSuggestionsTool: ToolDefinition<Input, Output> = {
  name: 'list_suggestions',
  description: 'Active suggestions for the household, optionally filtered by segment or status.',
  class: 'read',
  input: inputSchema,
  output: outputSchema,
  segments: 'all',
  async handler(args, ctx) {
    let q = ctx.supabase
      .schema('app')
      .from('suggestion')
      .select('id, segment, kind, title, rationale, status, created_at, preview')
      .eq('household_id', ctx.householdId);
    if (args.segment) q = q.eq('segment', args.segment);
    q = q.eq('status', args.status ?? 'pending');
    q = q.order('created_at', { ascending: false }).limit(args.limit ?? 50);
    const { data, error } = await q;
    if (error) throw new ToolError('db_error', `list_suggestions: ${error.message}`);
    return {
      suggestions: (data ?? []).map((s: SuggestionRow) => ({
        id: s.id,
        segment: s.segment,
        kind: s.kind,
        title: s.title,
        rationale: s.rationale,
        status: s.status,
        created_at: s.created_at,
        preview: s.preview,
      })),
    };
  },
};
