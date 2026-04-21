/**
 * `consolidator` handler — M3.7-A real implementation.
 *
 * Nightly pass per household:
 *
 *   1. Pick candidate entities:
 *      nodes with ≥ MIN_NEW_EPISODES_FOR_CONSOLIDATION new episodes
 *      since the node's last `metadata.consolidated_at`. Sort by count
 *      desc, cap at MAX_ENTITIES_PER_RUN.
 *   2. For each entity:
 *      - `withBudgetGuard({task_class:'consolidation'})`. Skip on
 *        budget_exceeded (essential cost discipline; reflection /
 *        consolidation are first to degrade per the briefing).
 *      - Build the consolidation/entity prompt, call Kimi at
 *        `temperature: 0.2, maxOutputTokens: 1200, cache: 'auto'`.
 *      - Resolve each returned fact's subject / object references to
 *        `mem.node` ids via the same resolver the enrichment worker
 *        uses, insert `mem.fact_candidate` with
 *        `source='consolidation'`, evidence carrying the episode ids
 *        the model cited.
 *      - Inline-reconcile each new candidate via `reconcileCandidate`.
 *      - Stamp `mem.node.metadata.consolidated_at` and
 *        `consolidated_version` on the node.
 *      - Enqueue `node_regen` for the touched node.
 *      - Audit `mem.node.consolidated`.
 *   3. Structural pattern pass (no model calls):
 *      - Temporal (weekday support ≥ 60%, total ≥ 4).
 *      - Co-occurrence (pair ratio ≥ 40% of either participant's
 *        episodes; count ≥ 3).
 *      - Threshold (stub — event/conversation episodes carry no
 *        numeric field yet).
 *      - Upserts on `(household_id, kind, description_hash)`.
 *   4. Final audit: `mem.consolidation.completed` with counts.
 *
 * Cost discipline:
 *   - MIN_NEW_EPISODES_FOR_CONSOLIDATION (3) skips entities with too
 *     little new signal — same policy as the briefing's cost-control
 *     guidance.
 *   - MAX_ENTITIES_PER_RUN (25) caps per-run blast radius in case an
 *     active week drops 200 entities into the pool.
 *   - `withBudgetGuard` per-entity, not per-run: a household can hit
 *     the cap mid-pass and cleanly stop calling the model.
 */

import { type Database, type Json } from '@homehub/db';
import {
  reconcileCandidate,
  type HouseholdContext as EnrichmentHouseholdContext,
} from '@homehub/enrichment';
import {
  entityConsolidationSchema,
  loadPrompt,
  renderPrompt,
  type EntityConsolidationResponse,
} from '@homehub/prompts';
import { type HouseholdId, type NodeType } from '@homehub/shared';
import {
  queueNames,
  withBudgetGuard,
  type Logger,
  type ModelClient,
  type QueueClient,
  type ServiceSupabaseClient,
} from '@homehub/worker-runtime';
import { type SupabaseClient } from '@supabase/supabase-js';

import { runStructuralPatternPass } from './patterns.js';

type NodeRow = Database['mem']['Tables']['node']['Row'];
type EpisodeRow = Database['mem']['Tables']['episode']['Row'];
type FactRow = Database['mem']['Tables']['fact']['Row'];

/**
 * Prompt version pinned here so the worker can persist the version
 * it ran with on `mem.node.metadata.consolidated_version`. When the
 * prompt version changes, nodes consolidated against the old version
 * are candidates for reprocessing — that's the backfill hook.
 */
export const CONSOLIDATION_PROMPT_VERSION = '2026-04-20-consolidation-v1';

/** Skip entities with fewer than this many new episodes. */
export const MIN_NEW_EPISODES_FOR_CONSOLIDATION = 3;

/** Cap per-run consolidations so a spiky household doesn't drain the budget. */
export const MAX_ENTITIES_PER_RUN = 25;

/** Window for "recent episodes" passed to the entity consolidation prompt. */
export const RECENT_EPISODES_FOR_PROMPT = 20;

export interface ConsolidatorDeps {
  supabase: SupabaseClient<Database>;
  queues: QueueClient;
  log: Logger;
  /** Required — the consolidator calls the model for every entity. */
  modelClient: ModelClient;
  now?: () => Date;
}

export interface RunConsolidatorOptions {
  /**
   * When omitted, the worker iterates every household. When passed,
   * only the listed households are processed (useful for backfills +
   * local development).
   */
  householdIds?: HouseholdId[];
  /** Reference date; defaults to "now". */
  asOf?: string;
}

export interface RunConsolidatorReport {
  householdsProcessed: number;
  entitiesConsolidated: number;
  factCandidatesWritten: number;
  patternsUpserted: number;
  /** Households that were skipped entirely because budget was exceeded. */
  budgetExceededHouseholds: number;
}

/**
 * Top-level orchestration entry. Exposed for the CLI main.ts + tests.
 */
export async function runConsolidator(
  deps: ConsolidatorDeps,
  opts: RunConsolidatorOptions = {},
): Promise<RunConsolidatorReport> {
  const report: RunConsolidatorReport = {
    householdsProcessed: 0,
    entitiesConsolidated: 0,
    factCandidatesWritten: 0,
    patternsUpserted: 0,
    budgetExceededHouseholds: 0,
  };

  const households = opts.householdIds?.length
    ? opts.householdIds
    : await loadAllHouseholdIds(deps.supabase);

  for (const householdId of households) {
    try {
      const perHousehold = await runHouseholdConsolidation(deps, householdId);
      report.householdsProcessed += 1;
      report.entitiesConsolidated += perHousehold.entitiesConsolidated;
      report.factCandidatesWritten += perHousehold.factCandidatesWritten;
      report.patternsUpserted += perHousehold.patternsUpserted;
      if (perHousehold.budgetExceeded) report.budgetExceededHouseholds += 1;
    } catch (err) {
      deps.log.error('consolidator: household run failed', {
        household_id: householdId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return report;
}

interface HouseholdConsolidationReport {
  entitiesConsolidated: number;
  factCandidatesWritten: number;
  patternsUpserted: number;
  budgetExceeded: boolean;
}

async function runHouseholdConsolidation(
  deps: ConsolidatorDeps,
  householdId: HouseholdId,
): Promise<HouseholdConsolidationReport> {
  const log = deps.log.child({ household_id: householdId });
  const now = (deps.now ?? (() => new Date()))();

  // 1. Candidate entities.
  const candidates = await pickConsolidationCandidates(deps.supabase, householdId);
  log.info('consolidator: candidate entities selected', { count: candidates.length });

  let entitiesConsolidated = 0;
  let factCandidatesWritten = 0;
  let budgetExceeded = false;

  for (const candidate of candidates) {
    const budget = await withBudgetGuard(
      deps.supabase as unknown as ServiceSupabaseClient,
      { household_id: householdId, task_class: 'consolidation' },
      log,
    );
    if (!budget.ok) {
      log.warn('consolidator: budget exceeded, halting entity pass', {
        node_id: candidate.nodeId,
      });
      budgetExceeded = true;
      break;
    }

    try {
      const result = await runEntityConsolidation(
        { ...deps, log },
        householdId,
        candidate.nodeId,
        now,
      );
      if (result.ran) entitiesConsolidated += 1;
      factCandidatesWritten += result.candidatesWritten;
    } catch (err) {
      log.warn('consolidator: entity consolidation failed; continuing', {
        node_id: candidate.nodeId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 2. Structural patterns (no model calls — always safe to run).
  let patternsUpserted = 0;
  try {
    const patternResult = await runStructuralPatternPass(
      { supabase: deps.supabase, log, now: () => now },
      householdId,
    );
    patternsUpserted = patternResult.upserts;
  } catch (err) {
    log.warn('consolidator: structural pattern pass failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 3. Audit the full pass.
  await writeAudit(deps.supabase, {
    household_id: householdId,
    action: 'mem.consolidation.completed',
    resource_id: householdId,
    before: null,
    after: {
      entities_considered: candidates.length,
      entities_consolidated: entitiesConsolidated,
      fact_candidates_written: factCandidatesWritten,
      patterns_upserted: patternsUpserted,
      budget_exceeded: budgetExceeded,
      at: now.toISOString(),
      prompt_version: CONSOLIDATION_PROMPT_VERSION,
    },
  });

  return {
    entitiesConsolidated,
    factCandidatesWritten,
    patternsUpserted,
    budgetExceeded,
  };
}

// -----------------------------------------------------------------
// Candidate selection
// -----------------------------------------------------------------

export interface ConsolidationCandidate {
  nodeId: string;
  newEpisodeCount: number;
}

/**
 * Pick entities for this run. We only ever consider nodes that have
 * ≥ `MIN_NEW_EPISODES_FOR_CONSOLIDATION` episodes since
 * `metadata.consolidated_at` (or ever, if they've never been
 * consolidated). Sort by new-episode count desc, cap at
 * `MAX_ENTITIES_PER_RUN`. Exposed for unit tests.
 */
export async function pickConsolidationCandidates(
  supabase: SupabaseClient<Database>,
  householdId: HouseholdId,
  opts: { minNewEpisodes?: number; cap?: number } = {},
): Promise<ConsolidationCandidate[]> {
  const minNew = opts.minNewEpisodes ?? MIN_NEW_EPISODES_FOR_CONSOLIDATION;
  const cap = opts.cap ?? MAX_ENTITIES_PER_RUN;

  const { data: nodes, error: nodeErr } = await supabase
    .schema('mem')
    .from('node')
    .select('id, metadata')
    .eq('household_id', householdId);
  if (nodeErr) throw new Error(`mem.node load failed: ${nodeErr.message}`);

  if (!nodes || nodes.length === 0) return [];

  // Load recent episodes in one pass so we don't issue N+1 queries.
  // Bounded window: look back 60 days.
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const { data: eps, error: epErr } = await supabase
    .schema('mem')
    .from('episode')
    .select('id, occurred_at, participants, place_node_id')
    .eq('household_id', householdId)
    .gte('occurred_at', since);
  if (epErr) throw new Error(`mem.episode load failed: ${epErr.message}`);
  const episodes = (eps ?? []) as Array<
    Pick<EpisodeRow, 'id' | 'occurred_at' | 'participants' | 'place_node_id'>
  >;

  const counts = new Map<string, { count: number; consolidatedAt?: string }>();
  for (const node of nodes) {
    const meta = node.metadata;
    const consolidatedAt = readConsolidatedAt(meta);
    counts.set(node.id as string, {
      count: 0,
      ...(consolidatedAt ? { consolidatedAt } : {}),
    });
  }

  for (const ep of episodes) {
    const ids = new Set<string>();
    for (const p of ep.participants) ids.add(p);
    if (ep.place_node_id) ids.add(ep.place_node_id);
    for (const id of ids) {
      const entry = counts.get(id);
      if (!entry) continue;
      if (entry.consolidatedAt && ep.occurred_at <= entry.consolidatedAt) continue;
      entry.count += 1;
    }
  }

  const selected: ConsolidationCandidate[] = [];
  for (const [nodeId, { count }] of counts) {
    if (count >= minNew) selected.push({ nodeId, newEpisodeCount: count });
  }
  selected.sort((a, b) => b.newEpisodeCount - a.newEpisodeCount);
  return selected.slice(0, cap);
}

function readConsolidatedAt(metadata: unknown): string | undefined {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const raw = (metadata as Record<string, unknown>).consolidated_at;
    if (typeof raw === 'string' && raw.length > 0) return raw;
  }
  return undefined;
}

// -----------------------------------------------------------------
// Per-entity consolidation
// -----------------------------------------------------------------

export interface EntityConsolidationResult {
  /** Whether the model was actually called. */
  ran: boolean;
  candidatesWritten: number;
}

/**
 * Run the consolidation prompt for one entity, write any produced
 * fact candidates, inline-reconcile them, and stamp
 * `consolidated_at`. Exposed for unit tests.
 */
export async function runEntityConsolidation(
  deps: ConsolidatorDeps,
  householdId: HouseholdId,
  nodeId: string,
  now: Date,
): Promise<EntityConsolidationResult> {
  const { supabase, log, modelClient } = deps;

  const node = await loadNode(supabase, householdId, nodeId);
  if (!node) return { ran: false, candidatesWritten: 0 };

  const [canonicalFacts, recentEpisodes] = await Promise.all([
    loadCanonicalFactsForNode(supabase, householdId, nodeId),
    loadRecentEpisodesForNode(supabase, householdId, nodeId),
  ]);
  if (recentEpisodes.length < 2) {
    // Atomicity of the prompt contract: we require ≥2 distinct
    // episodes for the model to emit any fact. If the node has <2
    // we skip the model call entirely.
    return { ran: false, candidatesWritten: 0 };
  }

  const prompt = loadPrompt('consolidation/entity');
  const rendered = renderPrompt(prompt, {
    household_context: summarizeHousehold(householdId),
    entity: formatEntity(node),
    canonical_facts: formatCanonicalFacts(canonicalFacts),
    recent_episodes: formatRecentEpisodes(recentEpisodes),
  });

  const result = await modelClient.generate({
    task: 'consolidation.entity',
    household_id: householdId,
    systemPrompt: rendered.systemPrompt,
    userPrompt: rendered.userPrompt,
    schema: entityConsolidationSchema,
    temperature: 0.2,
    maxOutputTokens: 1200,
    cache: 'auto',
  });
  const parsed = result.parsed as EntityConsolidationResponse | undefined;
  if (!parsed) {
    log.warn('consolidator: model returned no parsed output', { node_id: nodeId });
    return { ran: true, candidatesWritten: 0 };
  }

  let candidatesWritten = 0;
  const touchedNodeIds = new Set<string>([nodeId]);
  const newlyCreatedNodeIds = new Set<string>();

  if (parsed.facts.length > 0) {
    const resolver = createNodeResolver({
      supabase,
      householdId,
      log,
      newlyCreatedNodeIds,
    });

    for (const fact of parsed.facts) {
      try {
        const subjectNodeId = await resolver.resolve(fact.subject, inferTypeFromNode(node));
        const objectNodeId = fact.object_node_reference
          ? await resolver.resolve(fact.object_node_reference, inferTypeFromNode(node))
          : null;
        const validFromIso = fact.valid_from === 'inferred' ? now.toISOString() : fact.valid_from;
        const insert: Database['mem']['Tables']['fact_candidate']['Insert'] = {
          household_id: householdId,
          subject_node_id: subjectNodeId,
          predicate: fact.predicate,
          object_value: (fact.object_value ?? null) as Json,
          object_node_id: objectNodeId,
          confidence: fact.confidence,
          evidence: [
            {
              source_type: 'consolidation',
              source_id: nodeId,
              note: fact.evidence,
              prompt_version: CONSOLIDATION_PROMPT_VERSION,
              qualifier: fact.qualifier ?? null,
            },
          ] as unknown as Json,
          valid_from: validFromIso,
          recorded_at: now.toISOString(),
          source: 'consolidation',
          status: 'pending',
        };
        const { data: candRow, error: candErr } = await supabase
          .schema('mem')
          .from('fact_candidate')
          .insert(insert)
          .select('id')
          .single();
        if (candErr || !candRow) {
          throw new Error(`mem.fact_candidate insert failed: ${candErr?.message ?? 'no id'}`);
        }
        candidatesWritten += 1;
        touchedNodeIds.add(subjectNodeId);
        if (objectNodeId) touchedNodeIds.add(objectNodeId);

        // Inline reconcile so the consolidator can claim durable
        // progress on this candidate before moving on.
        try {
          const recResult = await reconcileCandidate(
            { supabase, log, now: () => now },
            candRow.id as string,
          );
          for (const id of recResult.touchedNodeIds) touchedNodeIds.add(id);
        } catch (err) {
          log.warn('consolidator: reconcile failed; candidate stays pending', {
            candidate_id: candRow.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } catch (err) {
        log.warn('consolidator: fact candidate write failed; skipping', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Stamp consolidated_at + version on the node so next run skips it.
  const nextNodeMetadata: Json = {
    ...(isJsonObject(node.metadata) ? node.metadata : {}),
    consolidated_at: now.toISOString(),
    consolidated_version: CONSOLIDATION_PROMPT_VERSION,
  };
  const { error: upErr } = await supabase
    .schema('mem')
    .from('node')
    .update({ metadata: nextNodeMetadata, updated_at: now.toISOString() })
    .eq('id', nodeId);
  if (upErr) {
    log.warn('consolidator: node metadata update failed', { error: upErr.message });
  }

  // Enqueue regen + embed for any touched node.
  for (const id of touchedNodeIds) {
    try {
      await deps.queues.send(queueNames.nodeRegen, {
        household_id: householdId,
        kind: 'node.regen',
        entity_id: id,
        version: 1,
        enqueued_at: now.toISOString(),
      });
    } catch (err) {
      log.warn('consolidator: node_regen enqueue failed', {
        node_id: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  for (const id of newlyCreatedNodeIds) {
    try {
      await deps.queues.send(queueNames.embedNode, {
        household_id: householdId,
        kind: 'node.embed',
        entity_id: id,
        version: 1,
        enqueued_at: now.toISOString(),
      });
    } catch (err) {
      log.warn('consolidator: embed_node enqueue failed', {
        node_id: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await writeAudit(supabase, {
    household_id: householdId,
    action: 'mem.node.consolidated',
    resource_id: nodeId,
    before: null,
    after: {
      candidates_written: candidatesWritten,
      touched_nodes: touchedNodeIds.size,
      new_nodes: newlyCreatedNodeIds.size,
      prompt_version: CONSOLIDATION_PROMPT_VERSION,
      model: result.model,
      cost_usd: result.costUsd,
    },
  });

  return { ran: true, candidatesWritten };
}

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

async function loadAllHouseholdIds(supabase: SupabaseClient<Database>): Promise<HouseholdId[]> {
  const { data, error } = await supabase.schema('app').from('household').select('id');
  if (error) throw new Error(`app.household load failed: ${error.message}`);
  return (data ?? []).map((r) => r.id as HouseholdId);
}

async function loadNode(
  supabase: SupabaseClient<Database>,
  householdId: HouseholdId,
  nodeId: string,
): Promise<NodeRow | null> {
  const { data, error } = await supabase
    .schema('mem')
    .from('node')
    .select('*')
    .eq('household_id', householdId)
    .eq('id', nodeId)
    .maybeSingle();
  if (error) throw new Error(`mem.node load failed: ${error.message}`);
  return data as NodeRow | null;
}

async function loadCanonicalFactsForNode(
  supabase: SupabaseClient<Database>,
  householdId: HouseholdId,
  nodeId: string,
): Promise<FactRow[]> {
  const [subjectRes, objectRes] = await Promise.all([
    supabase
      .schema('mem')
      .from('fact')
      .select('*')
      .eq('household_id', householdId)
      .eq('subject_node_id', nodeId)
      .is('valid_to', null)
      .is('superseded_at', null),
    supabase
      .schema('mem')
      .from('fact')
      .select('*')
      .eq('household_id', householdId)
      .eq('object_node_id', nodeId)
      .is('valid_to', null)
      .is('superseded_at', null),
  ]);
  if (subjectRes.error)
    throw new Error(`mem.fact subject load failed: ${subjectRes.error.message}`);
  if (objectRes.error) throw new Error(`mem.fact object load failed: ${objectRes.error.message}`);
  const merged = new Map<string, FactRow>();
  for (const r of (subjectRes.data ?? []) as FactRow[]) merged.set(r.id, r);
  for (const r of (objectRes.data ?? []) as FactRow[]) merged.set(r.id, r);
  return Array.from(merged.values());
}

async function loadRecentEpisodesForNode(
  supabase: SupabaseClient<Database>,
  householdId: HouseholdId,
  nodeId: string,
): Promise<EpisodeRow[]> {
  const [partRes, placeRes] = await Promise.all([
    supabase
      .schema('mem')
      .from('episode')
      .select('*')
      .eq('household_id', householdId)
      .overlaps('participants', [nodeId])
      .order('occurred_at', { ascending: false })
      .limit(RECENT_EPISODES_FOR_PROMPT),
    supabase
      .schema('mem')
      .from('episode')
      .select('*')
      .eq('household_id', householdId)
      .eq('place_node_id', nodeId)
      .order('occurred_at', { ascending: false })
      .limit(RECENT_EPISODES_FOR_PROMPT),
  ]);
  if (partRes.error) throw new Error(`mem.episode load failed: ${partRes.error.message}`);
  if (placeRes.error) throw new Error(`mem.episode load failed: ${placeRes.error.message}`);
  const merged = new Map<string, EpisodeRow>();
  for (const r of (partRes.data ?? []) as EpisodeRow[]) merged.set(r.id, r);
  for (const r of (placeRes.data ?? []) as EpisodeRow[]) merged.set(r.id, r);
  return Array.from(merged.values())
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, RECENT_EPISODES_FOR_PROMPT);
}

function formatEntity(node: NodeRow): string {
  return [
    `type: ${node.type}`,
    `canonical_name: ${node.canonical_name}`,
    `document_md: ${JSON.stringify(node.document_md ?? '')}`,
  ].join('\n');
}

function formatCanonicalFacts(facts: FactRow[]): string {
  if (facts.length === 0) return '(none)';
  return facts
    .map((f) => {
      const obj =
        f.object_value != null
          ? JSON.stringify(f.object_value)
          : f.object_node_id
            ? `node:${f.object_node_id}`
            : '(null)';
      return `- ${f.predicate} -> ${obj} (confidence ${f.confidence.toFixed(2)}, reinforced ${f.reinforcement_count}x, source ${f.source})`;
    })
    .join('\n');
}

function formatRecentEpisodes(episodes: EpisodeRow[]): string {
  if (episodes.length === 0) return '(none)';
  return episodes
    .map(
      (e) =>
        `- [${e.id}] ${e.occurred_at} — ${e.title}${e.summary ? `: ${e.summary.slice(0, 140)}` : ''} (participants: ${e.participants.length}, source=${e.source_type})`,
    )
    .join('\n');
}

function summarizeHousehold(householdId: HouseholdId): string {
  // Mirrors the minimal context the extractor passes today; richer
  // context is a backlog item tracked against the household.settings
  // rollout in `enrichment-pipeline.md`.
  return `Household ${householdId}; running nightly consolidation.`;
}

function inferTypeFromNode(node: NodeRow): NodeType {
  const t = node.type as NodeType;
  const allowed: NodeType[] = [
    'person',
    'place',
    'merchant',
    'dish',
    'ingredient',
    'topic',
    'event_type',
    'subscription',
    'account',
    'category',
  ];
  return (allowed as string[]).includes(t) ? t : 'person';
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function writeAudit(
  supabase: SupabaseClient<Database>,
  input: {
    household_id: string;
    action: string;
    resource_id: string;
    before: unknown;
    after: unknown;
  },
): Promise<void> {
  const { error } = await supabase
    .schema('audit')
    .from('event')
    .insert({
      household_id: input.household_id,
      actor_user_id: null,
      action: input.action,
      resource_type: 'mem.consolidation',
      resource_id: input.resource_id,
      before: input.before as Json,
      after: input.after as Json,
    });
  if (error) {
    console.warn(`[worker-consolidator] audit write failed: ${error.message}`);
  }
}

// -----------------------------------------------------------------
// Node resolver — same shape as enrichment worker's, kept local to
// avoid exporting an internal from `@homehub/enrichment`. When we
// pull a third consumer into the pattern we'll promote this to a
// shared helper.
// -----------------------------------------------------------------

interface NodeResolver {
  resolve(reference: string, defaultType: NodeType): Promise<string>;
}

function createNodeResolver(opts: {
  supabase: SupabaseClient<Database>;
  householdId: HouseholdId;
  log: Logger;
  newlyCreatedNodeIds: Set<string>;
}): NodeResolver {
  const cache = new Map<string, string>();

  function parseReference(ref: string): { type: NodeType | null; name: string } {
    const match = /^([a-z_]+):(.+)$/.exec(ref.trim());
    if (match) {
      const rawType = match[1]!;
      const name = match[2]!.trim();
      if (isValidNodeType(rawType)) return { type: rawType, name };
    }
    return { type: null, name: ref.trim() };
  }

  return {
    async resolve(ref: string, defaultType: NodeType): Promise<string> {
      const cached = cache.get(ref);
      if (cached) return cached;

      const { type, name } = parseReference(ref);
      const resolvedType: NodeType = type ?? defaultType;
      const canonical = name.toLowerCase();

      const { data: existing, error: exErr } = await opts.supabase
        .schema('mem')
        .from('node')
        .select('id')
        .eq('household_id', opts.householdId)
        .eq('type', resolvedType)
        .ilike('canonical_name', canonical)
        .limit(1);
      if (exErr) {
        opts.log.warn('consolidator resolver: node lookup failed', { error: exErr.message });
      }
      if (existing && existing.length > 0) {
        const id = existing[0]!.id as string;
        cache.set(ref, id);
        return id;
      }

      const { data: aliasRows, error: aliasErr } = await opts.supabase
        .schema('mem')
        .from('alias')
        .select('node_id')
        .eq('household_id', opts.householdId)
        .ilike('alias', canonical)
        .limit(1);
      if (aliasErr) {
        opts.log.warn('consolidator resolver: alias lookup failed', { error: aliasErr.message });
      }
      if (aliasRows && aliasRows.length > 0) {
        const id = aliasRows[0]!.node_id as string;
        cache.set(ref, id);
        return id;
      }

      const insert: Database['mem']['Tables']['node']['Insert'] = {
        household_id: opts.householdId,
        type: resolvedType,
        canonical_name: name,
        needs_review: true,
        metadata: { created_by: 'consolidation', reference: ref } as unknown as Json,
      };
      const { data: created, error: crErr } = await opts.supabase
        .schema('mem')
        .from('node')
        .insert(insert)
        .select('id')
        .single();
      if (crErr || !created) {
        throw new Error(`consolidator resolver: node insert failed: ${crErr?.message ?? 'no id'}`);
      }
      const id = created.id as string;
      opts.newlyCreatedNodeIds.add(id);
      cache.set(ref, id);
      return id;
    },
  };
}

function isValidNodeType(raw: string): raw is NodeType {
  return [
    'person',
    'place',
    'merchant',
    'dish',
    'ingredient',
    'topic',
    'event_type',
    'subscription',
    'account',
    'category',
  ].includes(raw);
}

// Preserve the M0 export name so the stub test stays meaningful. The
// new API is `runConsolidator`; `handler` is kept only so existing
// imports don't break, and throws if someone calls it directly.
export type { EnrichmentHouseholdContext };
export async function handler(): Promise<void> {
  throw new Error('consolidator handler() is not used at M3.7 — call runConsolidator() instead.');
}
