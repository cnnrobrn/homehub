/**
 * `query_memory` — layer-aware hybrid memory retrieval.
 *
 * Spec: `specs/04-memory-network/retrieval.md` (tool surface +
 * ranking) + `specs/04-memory-network/temporal.md` (`as_of` filter).
 *
 * Strategy (per spec, "default to hybrid"):
 *   1. Embed the query text.
 *   2. Semantic seed: top-N nodes by cosine distance (household-scoped,
 *      honoring optional `types` filter and `as_of`).
 *   3. Structural expand: walk `mem.edge` up to `max_depth` from each
 *      seed (default 2). In-memory BFS over the full edge table for
 *      the household — fine at M3 scales, revisited at 100k-node
 *      households.
 *   4. Collect facts for visited nodes (subject or object role).
 *   5. Collect episodes for visited nodes (participants or place).
 *   6. Optionally collect patterns (procedural layer).
 *   7. Rank + truncate per category.
 *   8. Surface conflicts separately.
 *
 * Every query is scoped by `householdId`; the function MUST apply the
 * filter to every SELECT so the service-role client can't leak
 * cross-household data.
 */

import { type HouseholdId, type NodeType } from '@homehub/shared';
import { type Logger, type ModelClient, type ServiceSupabaseClient } from '@homehub/worker-runtime';

import { cosineSimilarity, scoreFact, scoreNode } from './ranking.js';
import {
  DEFAULT_RANKING_WEIGHTS,
  type EdgeRow,
  type EpisodeRow,
  type FactRow,
  type NodeRow,
  type PatternRow,
  type QueryLayer,
  type QueryMemoryArgs,
  type QueryMemoryResult,
  type RankingWeights,
} from './types.js';

export interface CreateQueryMemoryOptions {
  supabase: ServiceSupabaseClient;
  modelClient: ModelClient;
  log: Logger;
  /** Defaults to `() => new Date()`. Tests override. */
  now?: () => Date;
}

export interface QueryMemoryClient {
  query(args: QueryMemoryArgs): Promise<QueryMemoryResult>;
}

const DEFAULT_LIMIT = 10;
const DEFAULT_MAX_DEPTH = 2;
const SEED_LIMIT = 20;

/**
 * Parse a pgvector embedding from a Supabase row. The generated type
 * is `string | null` because pgvector arrives as a JSON array string
 * like `"[0.12, -0.04, ...]"`. We parse defensively.
 */
function parseEmbedding(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    for (const v of parsed) if (typeof v !== 'number') return null;
    return parsed as number[];
  } catch {
    return null;
  }
}

/** Apply the `as_of` filter to facts per `specs/04-memory-network/temporal.md`. */
function factAsOfKeep(fact: FactRow, asOf: Date): boolean {
  if (Date.parse(fact.valid_from) > asOf.getTime()) return false;
  if (fact.valid_to && Date.parse(fact.valid_to) <= asOf.getTime()) return false;
  if (Date.parse(fact.recorded_at) > asOf.getTime()) return false;
  return true;
}

function episodeAsOfKeep(ep: EpisodeRow, asOf: Date): boolean {
  if (Date.parse(ep.recorded_at) > asOf.getTime()) return false;
  return true;
}

function nodeAsOfKeep(n: NodeRow, asOf: Date): boolean {
  if (Date.parse(n.created_at) > asOf.getTime()) return false;
  return true;
}

export function createQueryMemory(opts: CreateQueryMemoryOptions): QueryMemoryClient {
  const { supabase, modelClient, log, now: nowFn } = opts;
  const now = nowFn ?? (() => new Date());

  // In-memory embedding cache. Hot conversational turns often ask the
  // same thing twice within a minute; caching keeps the OpenRouter
  // bill honest.
  const embedCache = new Map<string, { at: number; vec: number[] }>();
  const EMBED_TTL_MS = 60_000;

  async function getEmbedding(householdId: HouseholdId, text: string): Promise<number[] | null> {
    const key = `${householdId}:${text}`;
    const cached = embedCache.get(key);
    if (cached && now().getTime() - cached.at < EMBED_TTL_MS) {
      return cached.vec;
    }
    try {
      const { embedding } = await modelClient.embed({
        text,
        household_id: householdId,
        task: 'query_memory.embed',
      });
      embedCache.set(key, { at: now().getTime(), vec: embedding });
      return embedding;
    } catch (err) {
      log.warn('query_memory: embed failed; falling back to semantic-less retrieval', {
        household_id: householdId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async function loadNodes(
    householdId: HouseholdId,
    types: NodeType[] | undefined,
  ): Promise<NodeRow[]> {
    let q = supabase.schema('mem').from('node').select('*').eq('household_id', householdId);
    if (types && types.length > 0) {
      q = q.in('type', types);
    }
    const { data, error } = await q;
    if (error) throw new Error(`query_memory: node load failed: ${error.message}`);
    return (data ?? []) as NodeRow[];
  }

  async function loadEdges(householdId: HouseholdId): Promise<EdgeRow[]> {
    const { data, error } = await supabase
      .schema('mem')
      .from('edge')
      .select('*')
      .eq('household_id', householdId);
    if (error) throw new Error(`query_memory: edge load failed: ${error.message}`);
    return (data ?? []) as EdgeRow[];
  }

  async function loadFactsForNodes(
    householdId: HouseholdId,
    nodeIds: string[],
  ): Promise<FactRow[]> {
    if (nodeIds.length === 0) return [];
    // Facts where node is subject OR object. Supabase-js has no
    // top-level OR across columns without .or(), so we run two
    // queries and merge.
    const [subRes, objRes] = await Promise.all([
      supabase
        .schema('mem')
        .from('fact')
        .select('*')
        .eq('household_id', householdId)
        .in('subject_node_id', nodeIds),
      supabase
        .schema('mem')
        .from('fact')
        .select('*')
        .eq('household_id', householdId)
        .in('object_node_id', nodeIds),
    ]);
    if (subRes.error) throw new Error(`query_memory: fact load failed: ${subRes.error.message}`);
    if (objRes.error) throw new Error(`query_memory: fact load failed: ${objRes.error.message}`);
    const merged = new Map<string, FactRow>();
    for (const row of (subRes.data ?? []) as FactRow[]) merged.set(row.id, row);
    for (const row of (objRes.data ?? []) as FactRow[]) merged.set(row.id, row);
    return Array.from(merged.values());
  }

  async function loadEpisodesForNodes(
    householdId: HouseholdId,
    nodeIds: string[],
  ): Promise<EpisodeRow[]> {
    if (nodeIds.length === 0) return [];
    const [partRes, placeRes] = await Promise.all([
      supabase
        .schema('mem')
        .from('episode')
        .select('*')
        .eq('household_id', householdId)
        .overlaps('participants', nodeIds),
      supabase
        .schema('mem')
        .from('episode')
        .select('*')
        .eq('household_id', householdId)
        .in('place_node_id', nodeIds),
    ]);
    if (partRes.error)
      throw new Error(`query_memory: episode load failed: ${partRes.error.message}`);
    if (placeRes.error)
      throw new Error(`query_memory: episode load failed: ${placeRes.error.message}`);
    const merged = new Map<string, EpisodeRow>();
    for (const row of (partRes.data ?? []) as EpisodeRow[]) merged.set(row.id, row);
    for (const row of (placeRes.data ?? []) as EpisodeRow[]) merged.set(row.id, row);
    return Array.from(merged.values());
  }

  async function loadPatterns(householdId: HouseholdId): Promise<PatternRow[]> {
    const { data, error } = await supabase
      .schema('mem')
      .from('pattern')
      .select('*')
      .eq('household_id', householdId)
      .eq('status', 'active');
    if (error) throw new Error(`query_memory: pattern load failed: ${error.message}`);
    return (data ?? []) as PatternRow[];
  }

  return {
    async query(args) {
      const layers: Set<QueryLayer> = new Set(
        args.layers && args.layers.length > 0
          ? args.layers
          : ['episodic', 'semantic', 'procedural'],
      );
      const includeConflicts = args.include_conflicts !== false;
      const limit = args.limit ?? DEFAULT_LIMIT;
      const maxDepth = Math.max(0, args.max_depth ?? DEFAULT_MAX_DEPTH);
      const weights: RankingWeights = { ...DEFAULT_RANKING_WEIGHTS, ...args.weights };
      const asOf = args.as_of ? new Date(args.as_of) : null;
      const halfLife = args.recency_half_life_days;
      const nowDate = now();

      const queryEmbedding = await getEmbedding(args.householdId, args.query);

      // --- Load nodes + edges (household-scoped) --------------------------
      const allNodes = await loadNodes(args.householdId, args.types);
      const allEdges = await loadEdges(args.householdId);

      const visibleNodes = asOf ? allNodes.filter((n) => nodeAsOfKeep(n, asOf)) : allNodes;

      // --- Semantic seed: rank nodes by similarity ------------------------
      const nodeSimilarity = new Map<string, number>();
      for (const n of visibleNodes) {
        const vec = parseEmbedding(n.embedding);
        if (queryEmbedding && vec) {
          nodeSimilarity.set(n.id, cosineSimilarity(queryEmbedding, vec));
        } else {
          // No embedding → neutral similarity. The node can still
          // surface via structural expansion or confidence.
          nodeSimilarity.set(n.id, 0);
        }
      }

      // Edge counts per node (connectivity term).
      const edgeCounts = new Map<string, number>();
      for (const e of allEdges) {
        edgeCounts.set(e.src_id, (edgeCounts.get(e.src_id) ?? 0) + 1);
        edgeCounts.set(e.dst_id, (edgeCounts.get(e.dst_id) ?? 0) + 1);
      }

      // When we have a query embedding, restrict seeds to nodes that
      // themselves have an embedding — otherwise "semantic seed"
      // degenerates to "every node." When the embedding call failed,
      // we fall back to treating every visible node as a candidate so
      // structural retrieval still works.
      const seedCandidates = queryEmbedding
        ? visibleNodes.filter((n) => parseEmbedding(n.embedding) !== null)
        : visibleNodes;

      const seeds = [...seedCandidates]
        .sort((a, b) => (nodeSimilarity.get(b.id) ?? 0) - (nodeSimilarity.get(a.id) ?? 0))
        .slice(0, SEED_LIMIT);

      // --- Structural expand: BFS over edges ------------------------------
      const visited = new Set<string>(seeds.map((s) => s.id));
      const neighbors = new Map<string, Set<string>>();
      for (const e of allEdges) {
        if (!neighbors.has(e.src_id)) neighbors.set(e.src_id, new Set());
        if (!neighbors.has(e.dst_id)) neighbors.set(e.dst_id, new Set());
        neighbors.get(e.src_id)!.add(e.dst_id);
        neighbors.get(e.dst_id)!.add(e.src_id);
      }

      let frontier = new Set(visited);
      for (let depth = 0; depth < maxDepth; depth += 1) {
        const next = new Set<string>();
        for (const id of frontier) {
          for (const nb of neighbors.get(id) ?? []) {
            if (!visited.has(nb)) {
              next.add(nb);
              visited.add(nb);
            }
          }
        }
        frontier = next;
        if (frontier.size === 0) break;
      }

      const visibleIds = new Set(visibleNodes.map((n) => n.id));
      const expandedNodes = Array.from(visited)
        .filter((id) => visibleIds.has(id))
        .map((id) => visibleNodes.find((n) => n.id === id)!)
        .filter(Boolean);

      // --- Rank nodes -----------------------------------------------------
      const rankedNodes = [...expandedNodes]
        .map((node) => ({
          node,
          score: scoreNode({
            node,
            similarity: nodeSimilarity.get(node.id) ?? 0,
            edgeCount: edgeCounts.get(node.id) ?? 0,
            weights,
            ...(halfLife !== undefined ? { halfLifeDays: halfLife } : {}),
            ...(args.types !== undefined ? { typeFilter: args.types } : {}),
            now: nowDate,
          }),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((r) => r.node);

      // --- Facts -----------------------------------------------------------
      const nodeIdsForFacts = Array.from(visited);
      let allFacts: FactRow[] = [];
      if (layers.has('semantic')) {
        allFacts = await loadFactsForNodes(args.householdId, nodeIdsForFacts);
      }

      const liveFacts = allFacts.filter((f) => {
        if (asOf) return factAsOfKeep(f, asOf);
        // Current-state filter: valid_to is null and not superseded.
        return f.valid_to === null && f.superseded_at === null;
      });

      const rankedFacts = liveFacts
        .map((fact) => ({
          fact,
          score: scoreFact({
            fact,
            subjectSimilarity: nodeSimilarity.get(fact.subject_node_id) ?? 0,
            weights,
            ...(halfLife !== undefined ? { halfLifeDays: halfLife } : {}),
            now: nowDate,
          }),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((r) => r.fact);

      // --- Episodes -------------------------------------------------------
      let episodes: EpisodeRow[] = [];
      if (layers.has('episodic')) {
        const raw = await loadEpisodesForNodes(args.householdId, nodeIdsForFacts);
        episodes = (asOf ? raw.filter((e) => episodeAsOfKeep(e, asOf)) : raw)
          .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
          .slice(0, limit);
      }

      // --- Patterns -------------------------------------------------------
      let patterns: PatternRow[] = [];
      if (layers.has('procedural')) {
        patterns = (await loadPatterns(args.householdId)).slice(0, limit);
      }

      // --- Edges between ranked nodes --------------------------------------
      const rankedNodeIds = new Set(rankedNodes.map((n) => n.id));
      const rankedEdges = allEdges.filter(
        (e) => rankedNodeIds.has(e.src_id) && rankedNodeIds.has(e.dst_id),
      );

      // --- Conflicts ------------------------------------------------------
      let conflicts: FactRow[] = [];
      if (includeConflicts) {
        const cutoff = nowDate.getTime() - 30 * 24 * 60 * 60 * 1000;
        conflicts = allFacts.filter(
          (f) =>
            f.conflict_status === 'parked_conflict' ||
            f.conflict_status === 'unresolved' ||
            (f.superseded_at != null && Date.parse(f.superseded_at) >= cutoff),
        );
      }

      return {
        nodes: rankedNodes,
        edges: rankedEdges,
        facts: rankedFacts,
        episodes,
        patterns,
        conflicts,
      };
    },
  };
}
