/**
 * `remember_fact` — direct-write.
 *
 * Inserts a `mem.fact_candidate` row with `source='member'`,
 * `confidence=1.0`, `status='pending'` so the reconciler promotes it
 * into a canonical fact on the next pass. Member-authored facts are
 * trusted: the reconciler fast-paths them per
 * `specs/04-memory-network/extraction.md`.
 *
 * Keeping the write inside the candidate table (rather than writing
 * directly to `mem.fact`) preserves the deduplication, merge, and
 * conflict-detection logic in one place.
 */

import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../types.js';

const inputSchema = z.object({
  subject_node_id: z.string().uuid().optional(),
  subject_name: z.string().min(1).optional(),
  predicate: z.string().min(1).max(128),
  object_node_id: z.string().uuid().optional(),
  object_value: z.unknown().optional(),
  valid_from: z.string().datetime().optional(),
});

const outputSchema = z.object({
  candidate_id: z.string(),
  status: z.literal('pending'),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const rememberFactTool: ToolDefinition<Input, Output> = {
  name: 'remember_fact',
  description:
    'Record a member-authored fact. Emits a high-confidence fact candidate that the reconciler promotes to canonical on the next pass.',
  class: 'direct-write',
  input: inputSchema,
  output: outputSchema,
  segments: 'all',
  async handler(args, ctx) {
    if (!args.subject_node_id && !args.subject_name) {
      throw new ToolError(
        'invalid_subject',
        'remember_fact requires either subject_node_id or subject_name',
      );
    }
    let subjectNodeId = args.subject_node_id ?? null;

    // If the caller gave a name rather than an id, resolve the canonical
    // node for the household. If there's no match we create one of type
    // 'concept' (a neutral default) so the candidate can be persisted.
    if (!subjectNodeId && args.subject_name) {
      const { data: existing, error: exErr } = await ctx.supabase
        .schema('mem')
        .from('node')
        .select('id')
        .eq('household_id', ctx.householdId)
        .ilike('canonical_name', args.subject_name)
        .maybeSingle();
      if (exErr) throw new ToolError('db_error', `remember_fact subject lookup: ${exErr.message}`);
      if (existing) {
        subjectNodeId = existing.id;
      } else {
        const { data: created, error: createErr } = await ctx.supabase
          .schema('mem')
          .from('node')
          .insert({
            household_id: ctx.householdId,
            type: 'concept',
            canonical_name: args.subject_name,
            needs_review: true,
          })
          .select('id')
          .single();
        if (createErr)
          throw new ToolError('db_error', `remember_fact subject create: ${createErr.message}`);
        subjectNodeId = created.id;
      }
    }

    const { data, error } = await ctx.supabase
      .schema('mem')
      .from('fact_candidate')
      .insert({
        household_id: ctx.householdId,
        subject_node_id: subjectNodeId,
        predicate: args.predicate,
        object_node_id: args.object_node_id ?? null,
        object_value: (args.object_value ?? null) as never,
        valid_from: args.valid_from ?? new Date().toISOString(),
        source: 'member',
        confidence: 1.0,
        status: 'pending',
        evidence: {
          source: 'tool:remember_fact',
          author_member_id: ctx.memberId,
          recorded_at: (ctx.now ? ctx.now() : new Date()).toISOString(),
        } as never,
      })
      .select('id')
      .single();
    if (error) throw new ToolError('db_error', `remember_fact insert: ${error.message}`);

    ctx.log.info('remember_fact candidate inserted', {
      household_id: ctx.householdId,
      candidate_id: data.id,
      predicate: args.predicate,
    });

    return { candidate_id: data.id, status: 'pending' };
  },
};
