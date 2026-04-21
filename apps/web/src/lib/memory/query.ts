/**
 * Server-side memory helpers for the `/memory` graph browser.
 *
 * Thin wrappers around `@homehub/query-memory` plus two direct
 * reads for the per-node detail page and the left-rail index. All
 * helpers run under the service-role client, scoped by `householdId`
 * in every WHERE clause — RLS already enforces the household
 * boundary for member-side updates; the service-role reads here are
 * internal to a Server Component that has already resolved the
 * authenticated member's household via `getHouseholdContext()`.
 *
 * These helpers are intentionally small and deterministic so the
 * page render stays snappy; heavier shaping (ranking, traversal)
 * happens inside `@homehub/query-memory`.
 *
 * These helpers MUST only be called from Server Components, Route
 * Handlers, and Server Actions — they touch the service-role
 * Supabase client and would explode in a browser context.
 */
import {
  createQueryMemory,
  type QueryMemoryArgs,
  type QueryMemoryResult,
  type NodeRow,
  type FactRow,
  type EpisodeRow,
  type EdgeRow,
} from '@homehub/query-memory';
import { type NodeType } from '@homehub/shared';
import { createServiceClient, createModelClient, type Logger } from '@homehub/worker-runtime';

import { memoryRuntimeEnv } from './runtime-env';

export type {
  EdgeRow,
  EpisodeRow,
  FactRow,
  NodeRow,
  QueryMemoryArgs,
  QueryMemoryResult,
} from '@homehub/query-memory';

/**
 * The request-scoped pieces of data a node-detail page needs.
 * Return shape is stable across the mem schema evolving — new
 * columns surface automatically via `Row` types.
 */
export interface NodeDetail {
  node: NodeRow;
  facts: FactRow[];
  episodes: EpisodeRow[];
  edges: EdgeRow[];
}

/**
 * Build a cheap console-backed `Logger`. We only need the shape
 * `@homehub/query-memory` and `@homehub/worker-runtime` consume;
 * the full pino-backed logger is overkill for an App Router
 * Server Component and would pull unnecessary worker deps into
 * the Next.js bundle evaluation.
 */
function createConsoleLogger(): Logger {
  const noop = (_msg: string, _ctx?: Record<string, unknown>) => {};
  const base: Logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: (msg, ctx) => console.warn(`[memory] ${msg}`, ctx ?? {}),
    error: (msg, ctx) => console.error(`[memory] ${msg}`, ctx ?? {}),
    fatal: (msg, ctx) => console.error(`[memory:fatal] ${msg}`, ctx ?? {}),
    child: () => base,
  };
  return base;
}

function runtimeClients() {
  const env = memoryRuntimeEnv();
  const supabase = createServiceClient(env);
  const log = createConsoleLogger();
  // The retrieval pipeline calls `embed()` for semantic seeds. If
  // OpenRouter isn't configured we degrade: `query_memory` internally
  // catches embed failures and falls back to structural-only
  // retrieval, so even a broken model client still produces useful
  // output.
  const modelClient = env.OPENROUTER_API_KEY
    ? createModelClient(env, { supabase, logger: log })
    : stubModelClient(log);
  return { supabase, modelClient, log };
}

function stubModelClient(log: Logger): ReturnType<typeof createModelClient> {
  // Minimal stub: throws on embed so `query_memory` logs and
  // degrades to structural retrieval. The warn log is intentional
  // — we want operators to notice an unconfigured env.
  const stub = {
    embed: async () => {
      log.warn('memory: OPENROUTER_API_KEY not set; degrading to structural-only retrieval');
      throw new Error('OPENROUTER_API_KEY not configured');
    },
    generate: async () => {
      throw new Error('generate() not available in @homehub/web runtime');
    },
  };
  return stub as unknown as ReturnType<typeof createModelClient>;
}

/**
 * Run `query_memory` for the `/memory` page's search box.
 */
export async function queryHouseholdMemory(args: QueryMemoryArgs): Promise<QueryMemoryResult> {
  const { supabase, modelClient, log } = runtimeClients();
  const client = createQueryMemory({ supabase, modelClient, log });
  return client.query(args);
}

/**
 * Resolve a single node + its facts, recent episodes (up to 25), and
 * outgoing edges. Scoped by `householdId` to keep the service-role
 * query honest about cross-household boundaries.
 */
export async function getNode(args: {
  householdId: string;
  nodeId: string;
}): Promise<NodeDetail | null> {
  const { supabase } = runtimeClients();

  const nodeRes = await supabase
    .schema('mem')
    .from('node')
    .select('*')
    .eq('household_id', args.householdId)
    .eq('id', args.nodeId)
    .maybeSingle();
  if (nodeRes.error) throw new Error(`getNode: node load failed: ${nodeRes.error.message}`);
  if (!nodeRes.data) return null;
  const node = nodeRes.data as NodeRow;

  const [subFactsRes, objFactsRes, partEpRes, placeEpRes, edgesRes] = await Promise.all([
    supabase
      .schema('mem')
      .from('fact')
      .select('*')
      .eq('household_id', args.householdId)
      .eq('subject_node_id', args.nodeId)
      .order('recorded_at', { ascending: false }),
    supabase
      .schema('mem')
      .from('fact')
      .select('*')
      .eq('household_id', args.householdId)
      .eq('object_node_id', args.nodeId)
      .order('recorded_at', { ascending: false }),
    supabase
      .schema('mem')
      .from('episode')
      .select('*')
      .eq('household_id', args.householdId)
      .overlaps('participants', [args.nodeId])
      .order('occurred_at', { ascending: false })
      .limit(25),
    supabase
      .schema('mem')
      .from('episode')
      .select('*')
      .eq('household_id', args.householdId)
      .eq('place_node_id', args.nodeId)
      .order('occurred_at', { ascending: false })
      .limit(25),
    supabase
      .schema('mem')
      .from('edge')
      .select('*')
      .eq('household_id', args.householdId)
      .or(`src_id.eq.${args.nodeId},dst_id.eq.${args.nodeId}`),
  ]);

  if (subFactsRes.error) throw new Error(`getNode: fact load failed: ${subFactsRes.error.message}`);
  if (objFactsRes.error) throw new Error(`getNode: fact load failed: ${objFactsRes.error.message}`);
  if (partEpRes.error) throw new Error(`getNode: episode load failed: ${partEpRes.error.message}`);
  if (placeEpRes.error)
    throw new Error(`getNode: episode load failed: ${placeEpRes.error.message}`);
  if (edgesRes.error) throw new Error(`getNode: edge load failed: ${edgesRes.error.message}`);

  const factMap = new Map<string, FactRow>();
  for (const r of (subFactsRes.data ?? []) as FactRow[]) factMap.set(r.id, r);
  for (const r of (objFactsRes.data ?? []) as FactRow[]) factMap.set(r.id, r);

  const episodeMap = new Map<string, EpisodeRow>();
  for (const r of (partEpRes.data ?? []) as EpisodeRow[]) episodeMap.set(r.id, r);
  for (const r of (placeEpRes.data ?? []) as EpisodeRow[]) episodeMap.set(r.id, r);

  return {
    node,
    facts: Array.from(factMap.values()).sort(
      (a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at),
    ),
    episodes: Array.from(episodeMap.values())
      .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
      .slice(0, 25),
    edges: (edgesRes.data ?? []) as EdgeRow[],
  };
}

export interface ListNodesArgs {
  householdId: string;
  types?: NodeType[];
  searchText?: string;
  limit?: number;
}

export interface NodeListRow extends NodeRow {
  /** Pinned-node bubble-to-top indicator derived from `metadata.pinned_by_member_ids`. */
  pinned: boolean;
  /** Resolved alias count for the left rail. */
  alias_count: number;
  /** Resolved fact count (live facts only). */
  fact_count: number;
}

/**
 * Index listing for the left rail and `/memory/[type]` pages.
 *
 * Filters by node type (optional) and by case-insensitive text
 * match against canonical_name OR alias text. When `searchText` is
 * omitted we return `limit` nodes ordered by pinned-first then by
 * updated_at desc.
 */
export async function listNodes(args: ListNodesArgs): Promise<NodeListRow[]> {
  const { supabase } = runtimeClients();
  const limit = args.limit ?? 100;

  // Nodes matching the type filter (and optionally the text filter).
  let nodeQ = supabase.schema('mem').from('node').select('*').eq('household_id', args.householdId);
  if (args.types && args.types.length > 0) {
    nodeQ = nodeQ.in('type', args.types);
  }
  if (args.searchText && args.searchText.length > 0) {
    // ilike over canonical_name keeps the query simple; alias-based
    // matches are layered in below via a second query.
    nodeQ = nodeQ.ilike('canonical_name', `%${args.searchText}%`);
  }
  nodeQ = nodeQ.order('updated_at', { ascending: false }).limit(limit);

  const { data: nodeRows, error: nodeErr } = await nodeQ;
  if (nodeErr) throw new Error(`listNodes: node load failed: ${nodeErr.message}`);

  let nodes = (nodeRows ?? []) as NodeRow[];

  // If searchText is set, additionally look up via alias → node.
  if (args.searchText && args.searchText.length > 0) {
    const { data: aliasRows, error: aliasErr } = await supabase
      .schema('mem')
      .from('alias')
      .select('node_id')
      .eq('household_id', args.householdId)
      .ilike('alias', `%${args.searchText}%`)
      .limit(limit);
    if (aliasErr) throw new Error(`listNodes: alias load failed: ${aliasErr.message}`);
    const extraIds = ((aliasRows ?? []) as Array<{ node_id: string }>)
      .map((r) => r.node_id)
      .filter((id) => !nodes.some((n) => n.id === id));
    if (extraIds.length > 0) {
      let extraQ = supabase
        .schema('mem')
        .from('node')
        .select('*')
        .eq('household_id', args.householdId)
        .in('id', extraIds);
      if (args.types && args.types.length > 0) {
        extraQ = extraQ.in('type', args.types);
      }
      const { data: extraNodes, error: extraErr } = await extraQ;
      if (extraErr) throw new Error(`listNodes: extra node load failed: ${extraErr.message}`);
      nodes = [...nodes, ...((extraNodes ?? []) as NodeRow[])];
    }
  }

  if (nodes.length === 0) return [];

  // Enrich with pinned state + alias/fact counts in parallel.
  const nodeIds = nodes.map((n) => n.id);
  const [aliasCountRes, factCountRes] = await Promise.all([
    supabase
      .schema('mem')
      .from('alias')
      .select('node_id')
      .eq('household_id', args.householdId)
      .in('node_id', nodeIds),
    supabase
      .schema('mem')
      .from('fact')
      .select('subject_node_id')
      .eq('household_id', args.householdId)
      .in('subject_node_id', nodeIds)
      .is('valid_to', null),
  ]);
  if (aliasCountRes.error)
    throw new Error(`listNodes: alias count failed: ${aliasCountRes.error.message}`);
  if (factCountRes.error)
    throw new Error(`listNodes: fact count failed: ${factCountRes.error.message}`);

  const aliasCounts = new Map<string, number>();
  for (const r of (aliasCountRes.data ?? []) as Array<{ node_id: string }>) {
    aliasCounts.set(r.node_id, (aliasCounts.get(r.node_id) ?? 0) + 1);
  }
  const factCounts = new Map<string, number>();
  for (const r of (factCountRes.data ?? []) as Array<{ subject_node_id: string }>) {
    factCounts.set(r.subject_node_id, (factCounts.get(r.subject_node_id) ?? 0) + 1);
  }

  const enriched: NodeListRow[] = nodes.map((n) => {
    const meta = (n.metadata ?? {}) as Record<string, unknown>;
    const pinnedList = Array.isArray(meta['pinned_by_member_ids'])
      ? (meta['pinned_by_member_ids'] as unknown[])
      : [];
    const deletedAt = meta['deleted_at'];
    const pinned = pinnedList.length > 0;
    return {
      ...n,
      pinned,
      alias_count: aliasCounts.get(n.id) ?? 0,
      fact_count: factCounts.get(n.id) ?? 0,
      // Soft-deleted nodes should not appear in the index.
      ...(typeof deletedAt === 'string' && deletedAt.length > 0 ? { __deleted: true } : {}),
    } as NodeListRow;
  });

  // Hide soft-deleted nodes, then pinned-first, then updated_at desc.
  return enriched
    .filter((n) => !(n as unknown as { __deleted?: boolean }).__deleted)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return Date.parse(b.updated_at) - Date.parse(a.updated_at);
    })
    .slice(0, limit);
}
