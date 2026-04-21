/**
 * `create_rule` — direct-write.
 *
 * Inserts a `mem.rule` row authored by the caller. Rules are editable
 * and non-destructive; per `specs/13-conversation/tools.md` they're a
 * direct-write (no approval needed).
 */

import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../types.js';

const inputSchema = z.object({
  description: z.string().min(1).max(500),
  predicate_dsl: z.record(z.string(), z.unknown()).optional(),
  active: z.boolean().optional(),
});

const outputSchema = z.object({
  rule_id: z.string(),
  active: z.boolean(),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const createRuleTool: ToolDefinition<Input, Output> = {
  name: 'create_rule',
  description:
    'Record a member-authored household rule (e.g. "don\'t suggest restaurants on Tuesdays"). Active immediately; editable later.',
  class: 'direct-write',
  input: inputSchema,
  output: outputSchema,
  segments: 'all',
  async handler(args, ctx) {
    const { data, error } = await ctx.supabase
      .schema('mem')
      .from('rule')
      .insert({
        household_id: ctx.householdId,
        author_member_id: ctx.memberId,
        description: args.description,
        predicate_dsl: (args.predicate_dsl ?? {}) as never,
        active: args.active ?? true,
      })
      .select('id, active')
      .single();
    if (error) throw new ToolError('db_error', `create_rule insert: ${error.message}`);
    return { rule_id: data.id, active: data.active };
  },
};
