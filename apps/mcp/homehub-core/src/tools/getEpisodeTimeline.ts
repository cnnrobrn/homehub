/**
 * `get_episode_timeline` MCP tool.
 *
 * Time-ordered slice of `mem.episode` for the caller's household,
 * with optional filters on `source_type` and a single
 * `participant_node_id`. Orders by `occurred_at asc` — the caller is
 * expected to render a timeline from earliest to latest.
 */

import { type Database } from '@homehub/db';
import { EPISODE_SOURCE_TYPES } from '@homehub/shared';
import { type ServiceSupabaseClient } from '@homehub/worker-runtime';
import { z } from 'zod';

import { type AuthContext } from '../middleware/auth.js';

import { jsonResult, parseOrThrow, type ToolResult } from './result.js';

export const GET_EPISODE_TIMELINE_TOOL_NAME = 'get_episode_timeline';

export const GET_EPISODE_TIMELINE_DESCRIPTION =
  'Fetch a time-ordered slice of episodes for the household.';

export const getEpisodeTimelineInputShape = {
  from: z.string().datetime(),
  to: z.string().datetime(),
  source_types: z.array(z.enum(EPISODE_SOURCE_TYPES)).optional(),
  participant_node_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(500).default(100),
} as const;

export const getEpisodeTimelineInputSchema = z.object(getEpisodeTimelineInputShape);
export type GetEpisodeTimelineInput = z.infer<typeof getEpisodeTimelineInputSchema>;

type EpisodeRow = Database['mem']['Tables']['episode']['Row'];

export interface GetEpisodeTimelineToolDeps {
  supabase: ServiceSupabaseClient;
}

export function createGetEpisodeTimelineTool(deps: GetEpisodeTimelineToolDeps): {
  name: string;
  description: string;
  inputSchema: typeof getEpisodeTimelineInputShape;
  handler: (input: unknown, ctx: AuthContext) => Promise<ToolResult>;
} {
  return {
    name: GET_EPISODE_TIMELINE_TOOL_NAME,
    description: GET_EPISODE_TIMELINE_DESCRIPTION,
    inputSchema: getEpisodeTimelineInputShape,
    handler: async (input, ctx) => {
      const parsed = parseOrThrow(getEpisodeTimelineInputSchema, input);
      if (new Date(parsed.to).getTime() <= new Date(parsed.from).getTime()) {
        return jsonResult({ episodes: [] });
      }
      let query = deps.supabase
        .schema('mem')
        .from('episode')
        .select('*')
        .eq('household_id', ctx.householdId)
        .gte('occurred_at', parsed.from)
        .lt('occurred_at', parsed.to);
      if (parsed.source_types && parsed.source_types.length > 0) {
        query = query.in('source_type', parsed.source_types);
      }
      if (parsed.participant_node_id) {
        query = query.contains('participants', [parsed.participant_node_id]);
      }
      query = query.order('occurred_at', { ascending: true }).limit(parsed.limit);

      const { data, error } = await query;
      if (error) {
        throw new Error(`get_episode_timeline: ${error.message}`);
      }
      return jsonResult({ episodes: (data ?? []) as EpisodeRow[] });
    },
  };
}
