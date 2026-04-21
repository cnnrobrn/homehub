/**
 * `get_episode_timeline` — time-ordered slice of `mem.episode`.
 *
 * Mirror of the MCP tool; accepts optional `source_types` filter and a
 * single `participant_node_id`.
 */

import { EPISODE_SOURCE_TYPES } from '@homehub/shared';
import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../types.js';

import type { Database } from '@homehub/db';

type EpisodeRow = Database['mem']['Tables']['episode']['Row'];

const inputSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  source_types: z.array(z.enum(EPISODE_SOURCE_TYPES)).optional(),
  participant_node_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

const outputSchema = z.object({
  episodes: z.array(z.unknown()),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const getEpisodeTimelineTool: ToolDefinition<Input, Output> = {
  name: 'get_episode_timeline',
  description: 'Fetch episodes for the household within a time window, oldest first.',
  class: 'read',
  input: inputSchema,
  output: outputSchema,
  segments: 'all',
  async handler(args, ctx) {
    if (new Date(args.to).getTime() <= new Date(args.from).getTime()) {
      return { episodes: [] };
    }
    let q = ctx.supabase
      .schema('mem')
      .from('episode')
      .select('*')
      .eq('household_id', ctx.householdId)
      .gte('occurred_at', args.from)
      .lt('occurred_at', args.to);
    if (args.source_types && args.source_types.length > 0) {
      q = q.in('source_type', args.source_types);
    }
    if (args.participant_node_id) {
      q = q.contains('participants', [args.participant_node_id]);
    }
    q = q.order('occurred_at', { ascending: true }).limit(args.limit ?? 100);
    const { data, error } = await q;
    if (error) throw new ToolError('db_error', `get_episode_timeline: ${error.message}`);
    return { episodes: (data ?? []) as EpisodeRow[] };
  },
};
