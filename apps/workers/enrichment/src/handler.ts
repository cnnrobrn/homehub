/**
 * `enrichment` handler (M3-B).
 *
 * Consumes `enrich_event` pgmq messages emitted by `sync-gcal`. Each
 * message's envelope references an `app.event` row. The handler:
 *
 *   1. Reads the event row.
 *   2. Builds the classifier input (including household context).
 *   3. Runs the `EnrichmentPipeline.classify()` path:
 *        - default tier → model classifier (Kimi K2)
 *        - degraded / exceeded tier or model error → deterministic
 *   4. Writes the classification back to `app.event`
 *      (segment + `metadata.enrichment`).
 *   5. Runs `EnrichmentPipeline.extract()` — only when the household
 *      has default-tier budget. Skipped on degraded by default; the
 *      dispatch brief calls this out as correct cost discipline.
 *   6. For each extracted episode: resolves participants / place to
 *      `mem.node` rows (creating new ones with `needs_review=true`
 *      when needed), inserts into `mem.episode`.
 *   7. For each extracted fact: resolves the subject and optional
 *      object node references to `mem.node` rows, inserts into
 *      `mem.fact_candidate` with `status='pending'`.
 *   8. Runs the reconciler on each new candidate.
 *   9. Enqueues `node_regen` for any newly-created subject nodes (and
 *      the subject nodes of promoted / superseded facts).
 *  10. Writes an audit row (`mem.event.enriched`) with before / after
 *      counts.
 *
 * Error policy:
 *   - Row missing → DLQ + ack.
 *   - Classification / pipeline error unrecoverably → DLQ + ack.
 *   - Extraction errors are non-fatal: the worker falls back to an
 *     empty extraction result so classification still lands.
 *   - Reconciler throws per candidate are caught and logged — the
 *     candidate stays pending for the next pass.
 *
 * Idempotency: extraction is keyed on (source_type='event', source_id,
 * prompt_version). Re-running on the same event produces the same
 * candidates; the reconciler sees them as reinforcements. Worker
 * writes are all idempotent-or-close — we let the database's unique
 * indexes catch dup inserts and we pass-through rather than fail.
 */

import { type Database, type Json } from '@homehub/db';
import {
  createDeterministicEventClassifier,
  createEnrichmentPipeline,
  createKimiEventClassifier,
  createKimiEventExtractor,
  DETERMINISTIC_CLASSIFIER_VERSION,
  EVENT_EXTRACTOR_PROMPT_VERSION,
  MODEL_CLASSIFIER_VERSION,
  reconcileCandidate,
  type EnrichmentPipeline,
  type EventClassification,
  type EventInput,
  type ExtractionResult,
  type HouseholdContext,
} from '@homehub/enrichment';
import { type HouseholdId, type NodeType } from '@homehub/shared';
import {
  queueNames,
  withBudgetGuard,
  type Logger,
  type MessageEnvelope,
  type ModelClient,
  type QueueClient,
  type ServiceSupabaseClient,
} from '@homehub/worker-runtime';
import { type SupabaseClient } from '@supabase/supabase-js';

type EventRow = Database['app']['Tables']['event']['Row'];

/**
 * Injectable set — every external is a dependency so the unit tests
 * can stub everything without touching a real Supabase, queue, or
 * model client.
 */
export interface EnrichmentHandlerDeps {
  supabase: SupabaseClient<Database>;
  queues: QueueClient;
  log: Logger;
  /**
   * Optional. When present, the pipeline uses the model path for
   * classification and extraction. When absent (tests or
   * model-less envs), the worker runs the deterministic classifier
   * only and skips extraction.
   */
  modelClient?: ModelClient;
  /** Default: `createEnrichmentPipeline(...)` built from `modelClient`. */
  pipeline?: EnrichmentPipeline;
  /** Default: `() => new Date()`. */
  now?: () => Date;
}

export interface EnrichmentMetadata {
  segment: EventClassification['segment'];
  kind: EventClassification['kind'];
  confidence: number;
  rationale: string;
  signals: string[];
  version: string;
  at: string;
  /** Source of the classification: 'model' or 'deterministic'. */
  source: 'model' | 'deterministic';
}

/**
 * Top-level: claim one → process → ack/DLQ. Returns whether we
 * claimed a message so the polling loop in `main.ts` can back off
 * when idle.
 */
export async function pollOnce(deps: EnrichmentHandlerDeps): Promise<'claimed' | 'idle'> {
  const queue = queueNames.enrichEvent;
  const claimed = await deps.queues.claim(queue);
  if (!claimed) return 'idle';

  const log = deps.log.child({
    queue,
    message_id: claimed.messageId,
    household_id: claimed.payload.household_id,
    entity_id: claimed.payload.entity_id,
  });

  try {
    await enrichOne({ ...deps, log }, claimed.payload);
    await deps.queues.ack(queue, claimed.messageId);
    return 'claimed';
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.error('enrichment handler failed; dead-lettering', { error: reason });
    await deps.queues.deadLetter(queue, claimed.messageId, reason, claimed.payload);
    await deps.queues.ack(queue, claimed.messageId);
    return 'claimed';
  }
}

/**
 * Per-message unit of work. Exposed for tests.
 */
export async function enrichOne(
  deps: EnrichmentHandlerDeps,
  envelope: MessageEnvelope,
): Promise<void> {
  const { supabase, log } = deps;
  const now = (deps.now ?? (() => new Date()))();

  const row = await loadEvent(supabase, envelope.household_id, envelope.entity_id);
  if (!row) {
    throw new Error(`app.event row not found: ${envelope.entity_id}`);
  }

  const input = buildClassifierInput(row);
  const householdId = row.household_id as HouseholdId;

  // --- Pipeline wiring -------------------------------------------------
  const pipeline = deps.pipeline ?? buildPipeline(deps);

  const budget = await withBudgetGuard(
    supabase as unknown as ServiceSupabaseClient,
    { household_id: householdId, task_class: 'enrichment.event' },
    log,
  );

  // --- Classify --------------------------------------------------------
  const classifyOutcome = await pipeline.classify({
    event: input,
    householdId,
    householdContext: summarizeHousehold(row),
    budget,
  });

  const enrichment = buildEnrichmentMetadata(
    classifyOutcome.classification,
    classifyOutcome.source,
    now,
  );

  const before = {
    segment: row.segment,
    metadata_enrichment: getMetadataEnrichment(row.metadata),
  };

  const nextMetadata: Json = {
    ...(isJsonObject(row.metadata) ? row.metadata : {}),
    enrichment: enrichment as unknown as Json,
  };

  const { error: updateError } = await supabase
    .schema('app')
    .from('event')
    .update({
      segment: classifyOutcome.classification.segment,
      metadata: nextMetadata,
      updated_at: now.toISOString(),
    })
    .eq('id', row.id);
  if (updateError) {
    throw new Error(`app.event update failed: ${updateError.message}`);
  }

  // --- Extract (when budget allows) -----------------------------------
  let extraction: ExtractionResult = { episodes: [], facts: [] };
  let extractionRan = false;
  let extractionReason = 'skipped_no_model';

  if (deps.modelClient || deps.pipeline) {
    const context: HouseholdContext = await buildHouseholdContext(supabase, householdId);
    const extractOutcome = await pipeline.extract({
      event: input,
      context,
      existingEnrichment: getMetadataEnrichment(row.metadata) ?? undefined,
      budget,
    });
    extraction = extractOutcome.extraction;
    extractionRan = extractOutcome.ran;
    extractionReason = extractOutcome.reason;
  }

  // --- Persist episodes + candidate facts -----------------------------
  let episodesWritten = 0;
  let candidatesWritten = 0;
  const reconciledCandidateIds: string[] = [];
  const touchedNodeIds = new Set<string>();
  const newlyCreatedNodeIds = new Set<string>();

  if (extractionRan && (extraction.episodes.length > 0 || extraction.facts.length > 0)) {
    // Build / cache node refs. The extractor returns references like
    // `person:Sarah` or bare emails; we upsert to a real node id.
    const resolver = createNodeResolver({
      supabase,
      householdId,
      log,
      newlyCreatedNodeIds,
    });

    // Write candidate facts first so episodes can reference their ids
    // via `mem.fact_candidate.id` (we map local f_001 -> candidate
    // row id).
    const factIdMap = new Map<string, string>();
    for (const fact of extraction.facts) {
      try {
        const subjectNodeId = await resolver.resolve(fact.subject, 'person');
        const objectNodeId = fact.object_node_reference
          ? await resolver.resolve(fact.object_node_reference, 'person')
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
              source_type: 'event',
              source_id: row.id,
              note: fact.evidence,
              prompt_version: EVENT_EXTRACTOR_PROMPT_VERSION,
              qualifier: fact.qualifier ?? null,
            },
          ] as unknown as Json,
          valid_from: validFromIso,
          recorded_at: now.toISOString(),
          source: 'extraction',
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
        factIdMap.set(fact.id, candRow.id as string);
        candidatesWritten += 1;
        touchedNodeIds.add(subjectNodeId);
        if (objectNodeId) touchedNodeIds.add(objectNodeId);
      } catch (err) {
        log.warn('enrichment: fact candidate write failed; skipping', {
          fact_id: fact.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    for (const ep of extraction.episodes) {
      try {
        const participantIds: string[] = [];
        for (const ref of ep.participants) {
          const id = await resolver.resolve(ref, 'person');
          participantIds.push(id);
          touchedNodeIds.add(id);
        }
        const placeNodeId = ep.place_reference
          ? await resolver.resolve(ep.place_reference, 'place')
          : null;
        if (placeNodeId) touchedNodeIds.add(placeNodeId);

        const insert: Database['mem']['Tables']['episode']['Insert'] = {
          household_id: householdId,
          title: ep.title,
          summary: ep.summary,
          occurred_at: ep.occurred_at,
          ended_at: ep.ended_at ?? null,
          place_node_id: placeNodeId,
          participants: participantIds,
          source_type: 'event',
          source_id: row.id,
          recorded_at: now.toISOString(),
          metadata: {
            prompt_version: EVENT_EXTRACTOR_PROMPT_VERSION,
            mentions_fact_candidates: ep.mentions_facts
              .map((fid) => factIdMap.get(fid))
              .filter((id): id is string => id != null),
          } as unknown as Json,
        };
        const { error: epErr } = await supabase.schema('mem').from('episode').insert(insert);
        if (epErr) {
          throw new Error(`mem.episode insert failed: ${epErr.message}`);
        }
        episodesWritten += 1;
      } catch (err) {
        log.warn('enrichment: episode write failed; skipping', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Reconcile each candidate; collect touched node ids for
    // node-regen enqueue.
    for (const candidateId of factIdMap.values()) {
      try {
        const result = await reconcileCandidate({ supabase, log, now: () => now }, candidateId);
        reconciledCandidateIds.push(candidateId);
        for (const nodeId of result.touchedNodeIds) touchedNodeIds.add(nodeId);
      } catch (err) {
        log.warn('enrichment: reconcile failed; candidate stays pending', {
          candidate_id: candidateId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // --- Enqueue node_regen for affected nodes --------------------------
  for (const nodeId of touchedNodeIds) {
    try {
      await deps.queues.send(queueNames.nodeRegen, {
        household_id: householdId,
        kind: 'node.regen',
        entity_id: nodeId,
        version: 1,
        enqueued_at: now.toISOString(),
      });
    } catch (err) {
      log.warn('enrichment: node_regen enqueue failed', {
        node_id: nodeId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // --- Enqueue embed_node for any newly created nodes ----------------
  // Embedding reflects (canonical_name + document_md + aliases). The
  // node-regen handler enqueues `embed_node` after it rewrites
  // document_md, so we only enqueue here for the very first creation
  // (the resolver adds an id to `newlyCreatedNodeIds` when it inserts).
  for (const nodeId of newlyCreatedNodeIds) {
    try {
      await deps.queues.send(queueNames.embedNode, {
        household_id: householdId,
        kind: 'node.embed',
        entity_id: nodeId,
        version: 1,
        enqueued_at: now.toISOString(),
      });
    } catch (err) {
      log.warn('enrichment: embed_node enqueue failed', {
        node_id: nodeId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // --- Audit ----------------------------------------------------------
  const after = {
    segment: classifyOutcome.classification.segment,
    metadata_enrichment: enrichment,
    extraction: {
      ran: extractionRan,
      reason: extractionReason,
      episodes: episodesWritten,
      candidates: candidatesWritten,
      reconciled: reconciledCandidateIds.length,
      new_nodes: newlyCreatedNodeIds.size,
    },
  };

  await writeAudit(supabase, {
    household_id: householdId,
    action: extractionRan ? 'mem.event.enriched' : 'event.enriched',
    resource_id: row.id,
    before,
    after,
  });

  log.info('event enriched', {
    segment: classifyOutcome.classification.segment,
    kind: classifyOutcome.classification.kind,
    source: classifyOutcome.source,
    extraction_ran: extractionRan,
    episodes: episodesWritten,
    candidates: candidatesWritten,
  });
}

// ---- Pipeline factory -------------------------------------------------

function buildPipeline(deps: EnrichmentHandlerDeps): EnrichmentPipeline {
  if (!deps.modelClient) {
    // Deterministic-only pipeline: stub model classifier/extractor
    // that always throws so the pipeline's fallback path fires.
    return createEnrichmentPipeline({
      modelClassifier: {
        classify: async () => {
          throw new Error('no model client configured');
        },
      },
      modelExtractor: {
        extract: async () => {
          throw new Error('no model client configured');
        },
      },
      deterministicClassifier: createDeterministicEventClassifier(),
      supabase: deps.supabase as unknown as ServiceSupabaseClient,
      log: deps.log,
    });
  }
  return createEnrichmentPipeline({
    modelClassifier: createKimiEventClassifier({ modelClient: deps.modelClient, log: deps.log }),
    modelExtractor: createKimiEventExtractor({ modelClient: deps.modelClient, log: deps.log }),
    deterministicClassifier: createDeterministicEventClassifier(),
    supabase: deps.supabase as unknown as ServiceSupabaseClient,
    log: deps.log,
  });
}

function buildEnrichmentMetadata(
  classification: EventClassification,
  source: 'model' | 'deterministic',
  now: Date,
): EnrichmentMetadata {
  return {
    segment: classification.segment,
    kind: classification.kind,
    confidence: classification.confidence,
    rationale: classification.rationale,
    signals: classification.signals,
    version: source === 'model' ? MODEL_CLASSIFIER_VERSION : DETERMINISTIC_CLASSIFIER_VERSION,
    at: now.toISOString(),
    source,
  };
}

// ---- Helpers ----------------------------------------------------------

async function loadEvent(
  supabase: SupabaseClient<Database>,
  householdId: string,
  id: string,
): Promise<EventRow | null> {
  const { data, error } = await supabase
    .schema('app')
    .from('event')
    .select('*')
    .eq('id', id)
    .eq('household_id', householdId)
    .maybeSingle();
  if (error) throw new Error(`app.event lookup failed: ${error.message}`);
  return data;
}

export function buildClassifierInput(row: EventRow): EventInput {
  const metadata = isJsonObject(row.metadata) ? row.metadata : {};
  const attendeesRaw = metadata.attendees;
  const attendees = Array.isArray(attendeesRaw)
    ? attendeesRaw
        .map((a) => normalizeAttendee(a))
        .filter((a): a is { email: string; displayName?: string } => a !== null)
    : [];

  const ownerEmail = typeof metadata.owner_email === 'string' ? metadata.owner_email : '';
  const description = typeof metadata.description === 'string' ? metadata.description : undefined;

  return {
    title: row.title,
    ...(description ? { description } : {}),
    ...(row.location ? { location: row.location } : {}),
    startsAt: row.starts_at,
    ...(row.ends_at ? { endsAt: row.ends_at } : {}),
    allDay: row.all_day,
    attendees,
    ownerEmail,
    ...(row.provider ? { provider: row.provider } : {}),
    metadata,
  };
}

function summarizeHousehold(row: EventRow): string {
  // M3-B: we don't yet carry a rich household-summary string through
  // pg. The household row has `settings` jsonb that may contain a
  // description in the future. For now emit a minimal tag so the
  // prompt has something.
  return `Household ${row.household_id}; processing event "${row.title}".`;
}

async function buildHouseholdContext(
  supabase: SupabaseClient<Database>,
  householdId: HouseholdId,
): Promise<HouseholdContext> {
  const [{ data: people }, { data: places }] = await Promise.all([
    supabase
      .schema('mem')
      .from('node')
      .select('id, canonical_name')
      .eq('household_id', householdId)
      .eq('type', 'person')
      .limit(50),
    supabase
      .schema('mem')
      .from('node')
      .select('id, canonical_name')
      .eq('household_id', householdId)
      .eq('type', 'place')
      .limit(50),
  ]);

  return {
    householdId,
    peopleRoster: (people ?? []).map((p) => ({
      id: p.id as string,
      name: p.canonical_name as string,
    })),
    placeRoster: (places ?? []).map((p) => ({
      id: p.id as string,
      name: p.canonical_name as string,
    })),
  };
}

function normalizeAttendee(raw: unknown): { email: string; displayName?: string } | null {
  if (!isJsonObject(raw)) return null;
  const email = raw.email;
  if (typeof email !== 'string' || email.length === 0) return null;
  const displayName = raw.displayName;
  return typeof displayName === 'string' ? { email, displayName } : { email };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getMetadataEnrichment(metadata: Json): unknown {
  if (isJsonObject(metadata)) return metadata.enrichment ?? null;
  return null;
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
      resource_type: 'app.event',
      resource_id: input.resource_id,
      before: input.before as Json,
      after: input.after as Json,
    });
  if (error) {
    console.warn(`[worker-enrichment] audit write failed: ${error.message}`);
  }
}

// ---- Node resolver ----------------------------------------------------

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

      // Try exact canonical_name match (case-insensitive via ilike).
      // Fall back to alias match.
      const { data: existing, error: exErr } = await opts.supabase
        .schema('mem')
        .from('node')
        .select('id')
        .eq('household_id', opts.householdId)
        .eq('type', resolvedType)
        .ilike('canonical_name', canonical)
        .limit(1);
      if (exErr) {
        opts.log.warn('resolver: node lookup failed', { error: exErr.message });
      }
      if (existing && existing.length > 0) {
        const id = existing[0]!.id as string;
        cache.set(ref, id);
        return id;
      }

      // Alias lookup.
      const { data: aliasRows, error: aliasErr } = await opts.supabase
        .schema('mem')
        .from('alias')
        .select('node_id')
        .eq('household_id', opts.householdId)
        .ilike('alias', canonical)
        .limit(1);
      if (aliasErr) {
        opts.log.warn('resolver: alias lookup failed', { error: aliasErr.message });
      }
      if (aliasRows && aliasRows.length > 0) {
        const id = aliasRows[0]!.node_id as string;
        cache.set(ref, id);
        return id;
      }

      // Create a new node with needs_review=true.
      const insert: Database['mem']['Tables']['node']['Insert'] = {
        household_id: opts.householdId,
        type: resolvedType,
        canonical_name: name,
        needs_review: true,
        metadata: { created_by: 'enrichment', reference: ref } as unknown as Json,
      };
      const { data: created, error: crErr } = await opts.supabase
        .schema('mem')
        .from('node')
        .insert(insert)
        .select('id')
        .single();
      if (crErr || !created) {
        throw new Error(`resolver: node insert failed: ${crErr?.message ?? 'no id'}`);
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
