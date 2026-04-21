/**
 * `get_household_members` — sanitized roster.
 *
 * Returns `{ id, display_name, role, joined_at }` — deliberately
 * excludes `email` and `user_id`. `segments: 'all'`.
 */

import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../types.js';

import type { Database } from '@homehub/db';

type MemberRow = Database['app']['Tables']['member']['Row'];

const inputSchema = z.object({});
const outputSchema = z.object({
  members: z.array(
    z.object({
      id: z.string(),
      display_name: z.string(),
      role: z.string(),
      joined_at: z.string().nullable(),
    }),
  ),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const getHouseholdMembersTool: ToolDefinition<Input, Output> = {
  name: 'get_household_members',
  description: 'List members of this household with their display names and roles.',
  class: 'read',
  input: inputSchema,
  output: outputSchema,
  segments: 'all',
  async handler(_args, ctx) {
    const { data, error } = await ctx.supabase
      .schema('app')
      .from('member')
      .select('id, display_name, role, joined_at')
      .eq('household_id', ctx.householdId)
      .order('joined_at', { ascending: true });
    if (error) throw new ToolError('db_error', `get_household_members: ${error.message}`);
    return {
      members: (data ?? []).map(
        (m: Pick<MemberRow, 'id' | 'display_name' | 'role' | 'joined_at'>) => ({
          id: m.id,
          display_name: m.display_name,
          role: m.role,
          joined_at: m.joined_at,
        }),
      ),
    };
  },
};
