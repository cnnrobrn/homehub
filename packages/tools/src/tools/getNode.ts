/**
 * `get_node` — fetch a memory node and its immediate context.
 *
 * Shape mirrors the MCP `get_node` tool so both surfaces agree:
 * node, live facts where node is subject, recent episodes, and
 * outgoing+incoming edges. Scoped to the caller's household in every
 * query.
 */

import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../types.js';

import type { Database } from '@homehub/db';

type NodeRow = Database['mem']['Tables']['node']['Row'];
type FactRow = Database['mem']['Tables']['fact']['Row'];
type EpisodeRow = Database['mem']['Tables']['episode']['Row'];
type EdgeRow = Database['mem']['Tables']['edge']['Row'];

const inputSchema = z.object({
  node_id: z.string().uuid(),
  episode_limit: z.number().int().min(1).max(100).optional(),
});

const outputSchema = z.object({
  node: z.unknown().nullable(),
  facts: z.array(z.unknown()),
  episodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const getNodeTool: ToolDefinition<Input, Output> = {
  name: 'get_node',
  description: 'Fetch a memory node: canonical document, live facts, recent episodes, edges.',
  class: 'read',
  input: inputSchema,
  output: outputSchema,
  segments: 'all',
  async handler(args, ctx) {
    const epLimit = args.episode_limit ?? 25;

    const { data: nodeData, error: nodeErr } = await ctx.supabase
      .schema('mem')
      .from('node')
      .select('*')
      .eq('household_id', ctx.householdId)
      .eq('id', args.node_id)
      .maybeSingle();
    if (nodeErr) throw new ToolError('db_error', `get_node node: ${nodeErr.message}`);
    const node = (nodeData ?? null) as NodeRow | null;
    if (!node) return { node: null, facts: [], episodes: [], edges: [] };

    const [factsRes, epPartRes, epPlaceRes, edgeSrcRes, edgeDstRes] = await Promise.all([
      ctx.supabase
        .schema('mem')
        .from('fact')
        .select('*')
        .eq('household_id', ctx.householdId)
        .eq('subject_node_id', args.node_id)
        .is('valid_to', null)
        .is('superseded_at', null),
      ctx.supabase
        .schema('mem')
        .from('episode')
        .select('*')
        .eq('household_id', ctx.householdId)
        .contains('participants', [args.node_id])
        .order('occurred_at', { ascending: false })
        .limit(epLimit),
      ctx.supabase
        .schema('mem')
        .from('episode')
        .select('*')
        .eq('household_id', ctx.householdId)
        .eq('place_node_id', args.node_id)
        .order('occurred_at', { ascending: false })
        .limit(epLimit),
      ctx.supabase
        .schema('mem')
        .from('edge')
        .select('*')
        .eq('household_id', ctx.householdId)
        .eq('src_id', args.node_id),
      ctx.supabase
        .schema('mem')
        .from('edge')
        .select('*')
        .eq('household_id', ctx.householdId)
        .eq('dst_id', args.node_id),
    ]);
    if (factsRes.error)
      throw new ToolError('db_error', `get_node facts: ${factsRes.error.message}`);
    if (epPartRes.error) throw new ToolError('db_error', `get_node ep: ${epPartRes.error.message}`);
    if (epPlaceRes.error)
      throw new ToolError('db_error', `get_node ep_place: ${epPlaceRes.error.message}`);
    if (edgeSrcRes.error)
      throw new ToolError('db_error', `get_node edges_src: ${edgeSrcRes.error.message}`);
    if (edgeDstRes.error)
      throw new ToolError('db_error', `get_node edges_dst: ${edgeDstRes.error.message}`);

    const epMap = new Map<string, EpisodeRow>();
    for (const e of (epPartRes.data ?? []) as EpisodeRow[]) epMap.set(e.id, e);
    for (const e of (epPlaceRes.data ?? []) as EpisodeRow[]) epMap.set(e.id, e);
    const edgeMap = new Map<string, EdgeRow>();
    for (const e of (edgeSrcRes.data ?? []) as EdgeRow[]) edgeMap.set(e.id, e);
    for (const e of (edgeDstRes.data ?? []) as EdgeRow[]) edgeMap.set(e.id, e);

    return {
      node,
      facts: (factsRes.data ?? []) as FactRow[],
      episodes: Array.from(epMap.values())
        .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
        .slice(0, epLimit),
      edges: Array.from(edgeMap.values()),
    };
  },
};
