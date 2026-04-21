/**
 * `get_node` MCP tool.
 *
 * Fetches one `mem.node` row plus, in parallel:
 *   - live facts where the node is the subject (honors `valid_to IS
 *     NULL` + `superseded_at IS NULL`),
 *   - recent episodes where the node is a participant OR the place,
 *   - outgoing + incoming edges.
 *
 * All queries are explicitly scoped to the caller's household. If
 * the node doesn't exist for this household (either deleted or
 * belongs to another household), the tool returns
 * `{ node: null, facts: [], episodes: [], edges: [] }` — never leaks
 * cross-household presence.
 */

import { type Database } from '@homehub/db';
import { type ServiceSupabaseClient } from '@homehub/worker-runtime';
import { z } from 'zod';

import { type AuthContext } from '../middleware/auth.js';

import { jsonResult, parseOrThrow, type ToolResult } from './result.js';

export const GET_NODE_TOOL_NAME = 'get_node';

export const GET_NODE_DESCRIPTION =
  'Fetch a memory node by id: canonical document, facts, episodes that reference it, and outgoing edges.';

export const getNodeInputShape = {
  node_id: z.string().uuid(),
  include_facts: z.boolean().default(true),
  include_episodes: z.boolean().default(true),
  include_edges: z.boolean().default(true),
  episode_limit: z.number().int().min(1).max(100).default(25),
} as const;

export const getNodeInputSchema = z.object(getNodeInputShape);
export type GetNodeInput = z.infer<typeof getNodeInputSchema>;

type NodeRow = Database['mem']['Tables']['node']['Row'];
type FactRow = Database['mem']['Tables']['fact']['Row'];
type EpisodeRow = Database['mem']['Tables']['episode']['Row'];
type EdgeRow = Database['mem']['Tables']['edge']['Row'];

export interface GetNodeToolDeps {
  supabase: ServiceSupabaseClient;
}

export interface GetNodeResult {
  node: NodeRow | null;
  facts: FactRow[];
  episodes: EpisodeRow[];
  edges: EdgeRow[];
}

export function createGetNodeTool(deps: GetNodeToolDeps): {
  name: string;
  description: string;
  inputSchema: typeof getNodeInputShape;
  handler: (input: unknown, ctx: AuthContext) => Promise<ToolResult>;
} {
  return {
    name: GET_NODE_TOOL_NAME,
    description: GET_NODE_DESCRIPTION,
    inputSchema: getNodeInputShape,
    handler: async (input, ctx) => {
      const parsed = parseOrThrow(getNodeInputSchema, input);
      const householdId = ctx.householdId;

      // --- Node ------------------------------------------------------
      const nodeRes = await deps.supabase
        .schema('mem')
        .from('node')
        .select('*')
        .eq('household_id', householdId)
        .eq('id', parsed.node_id)
        .maybeSingle();
      if (nodeRes.error) {
        throw new Error(`get_node: node load failed: ${nodeRes.error.message}`);
      }
      const node = (nodeRes.data ?? null) as NodeRow | null;
      if (!node) {
        const empty: GetNodeResult = { node: null, facts: [], episodes: [], edges: [] };
        return jsonResult(empty);
      }

      // --- Related rows in parallel ----------------------------------
      const [factsRes, episodesByParticipantRes, episodesByPlaceRes, edgesSrcRes, edgesDstRes] =
        await Promise.all([
          parsed.include_facts
            ? deps.supabase
                .schema('mem')
                .from('fact')
                .select('*')
                .eq('household_id', householdId)
                .eq('subject_node_id', parsed.node_id)
                .is('valid_to', null)
                .is('superseded_at', null)
            : Promise.resolve({ data: [] as FactRow[], error: null }),
          parsed.include_episodes
            ? deps.supabase
                .schema('mem')
                .from('episode')
                .select('*')
                .eq('household_id', householdId)
                .contains('participants', [parsed.node_id])
                .order('occurred_at', { ascending: false })
                .limit(parsed.episode_limit)
            : Promise.resolve({ data: [] as EpisodeRow[], error: null }),
          parsed.include_episodes
            ? deps.supabase
                .schema('mem')
                .from('episode')
                .select('*')
                .eq('household_id', householdId)
                .eq('place_node_id', parsed.node_id)
                .order('occurred_at', { ascending: false })
                .limit(parsed.episode_limit)
            : Promise.resolve({ data: [] as EpisodeRow[], error: null }),
          parsed.include_edges
            ? deps.supabase
                .schema('mem')
                .from('edge')
                .select('*')
                .eq('household_id', householdId)
                .eq('src_id', parsed.node_id)
            : Promise.resolve({ data: [] as EdgeRow[], error: null }),
          parsed.include_edges
            ? deps.supabase
                .schema('mem')
                .from('edge')
                .select('*')
                .eq('household_id', householdId)
                .eq('dst_id', parsed.node_id)
            : Promise.resolve({ data: [] as EdgeRow[], error: null }),
        ]);

      if (factsRes.error) {
        throw new Error(`get_node: fact load failed: ${factsRes.error.message}`);
      }
      if (episodesByParticipantRes.error) {
        throw new Error(
          `get_node: episode-participant load failed: ${episodesByParticipantRes.error.message}`,
        );
      }
      if (episodesByPlaceRes.error) {
        throw new Error(`get_node: episode-place load failed: ${episodesByPlaceRes.error.message}`);
      }
      if (edgesSrcRes.error) {
        throw new Error(`get_node: edges(src) load failed: ${edgesSrcRes.error.message}`);
      }
      if (edgesDstRes.error) {
        throw new Error(`get_node: edges(dst) load failed: ${edgesDstRes.error.message}`);
      }

      // Merge episodes from the two queries, dedupe by id, re-sort and
      // truncate to `episode_limit`.
      const mergedEpisodes = new Map<string, EpisodeRow>();
      for (const row of (episodesByParticipantRes.data ?? []) as EpisodeRow[]) {
        mergedEpisodes.set(row.id, row);
      }
      for (const row of (episodesByPlaceRes.data ?? []) as EpisodeRow[]) {
        mergedEpisodes.set(row.id, row);
      }
      const episodes = Array.from(mergedEpisodes.values())
        .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
        .slice(0, parsed.episode_limit);

      // Merge src+dst edges.
      const mergedEdges = new Map<string, EdgeRow>();
      for (const row of (edgesSrcRes.data ?? []) as EdgeRow[]) mergedEdges.set(row.id, row);
      for (const row of (edgesDstRes.data ?? []) as EdgeRow[]) mergedEdges.set(row.id, row);

      const result: GetNodeResult = {
        node,
        facts: (factsRes.data ?? []) as FactRow[],
        episodes,
        edges: Array.from(mergedEdges.values()),
      };
      return jsonResult(result);
    },
  };
}
