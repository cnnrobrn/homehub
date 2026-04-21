/**
 * `enrich_conversation` handler (M3.5-B).
 *
 * Consumes `enrich_conversation` pgmq messages emitted by the
 * foreground-agent loop (one per member turn). Each message's envelope
 * references an `app.conversation_turn` row whose `role='member'`. The
 * handler:
 *
 *   1. Reads the turn row (DLQ on miss; DLQ on role != 'member').
 *   2. Respects whisper mode: if `no_memory_write=true`, ack without
 *      any `mem.*` writes.
 *   3. Reads the conversation tail (last 3 member + assistant turns).
 *   4. Builds the known-people roster from `mem.node` type='person'.
 *   5. Calls the model-backed conversation extractor.
 *   6. For each fact: resolves subject / object node references,
 *      inserts `mem.fact_candidate` with `source='member'`, confidence
 *      clamped to the member-sourced ceiling.
 *   7. For each rule: inserts `mem.rule` directly (rules skip the
 *      candidate pool — they're member-authored by construction).
 *   8. Runs the reconciler on each new candidate.
 *   9. Enqueues `node_regen` and `embed_node` for any touched /
 *      newly-created nodes.
 *  10. Writes an audit row (`mem.conversation.extracted`).
 *
 * Idempotency: extraction is keyed on
 * (source_type='conversation', source_id=turn.id, prompt_version). The
 * DB's unique indexes + the reconciler's content-hash deduping handle
 * re-runs.
 */

import { type Database, type Json } from '@homehub/db';
import {
  CONVERSATION_EXTRACTOR_PROMPT_VERSION,
  createConversationExtractor,
  reconcileCandidate,
  type ConversationExtractor,
  type ConversationExtractionResult,
  type KnownPerson,
} from '@homehub/enrichment';
import { type HouseholdId, type NodeType } from '@homehub/shared';
import {
  queueNames,
  type Logger,
  type MessageEnvelope,
  type ModelClient,
  type QueueClient,
} from '@homehub/worker-runtime';
import { type SupabaseClient } from '@supabase/supabase-js';

type TurnRow = Database['app']['Tables']['conversation_turn']['Row'];

const MAX_TAIL_TURNS = 3;
const MAX_KNOWN_PEOPLE = 50;

export interface ConversationHandlerDeps {
  supabase: SupabaseClient<Database>;
  queues: QueueClient;
  log: Logger;
  /** Required — extractor makes a model call. */
  modelClient?: ModelClient;
  /** Default: created from modelClient. */
  extractor?: ConversationExtractor;
  /** Default: `() => new Date()`. */
  now?: () => Date;
}

/**
 * Claim + process one `enrich_conversation` message. Returns whether
 * we claimed a message so the main loop can back off when idle.
 */
export async function pollOnceConversation(
  deps: ConversationHandlerDeps,
): Promise<'claimed' | 'idle'> {
  const queue = queueNames.enrichConversation;
  const claimed = await deps.queues.claim(queue);
  if (!claimed) return 'idle';

  const log = deps.log.child({
    queue,
    message_id: claimed.messageId,
    household_id: claimed.payload.household_id,
    entity_id: claimed.payload.entity_id,
  });

  try {
    await enrichConversationOne({ ...deps, log }, claimed.payload);
    await deps.queues.ack(queue, claimed.messageId);
    return 'claimed';
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.error('enrich_conversation handler failed; dead-lettering', { error: reason });
    await deps.queues.deadLetter(queue, claimed.messageId, reason, claimed.payload);
    await deps.queues.ack(queue, claimed.messageId);
    return 'claimed';
  }
}

/**
 * Per-message unit of work. Exposed for tests.
 */
export async function enrichConversationOne(
  deps: ConversationHandlerDeps,
  envelope: MessageEnvelope,
): Promise<void> {
  const { supabase, log } = deps;
  const now = (deps.now ?? (() => new Date()))();

  const turn = await loadTurn(supabase, envelope.household_id, envelope.entity_id);
  if (!turn) {
    throw new Error(`app.conversation_turn row not found: ${envelope.entity_id}`);
  }
  if (turn.role !== 'member') {
    throw new Error(
      `app.conversation_turn role must be 'member' for enrich_conversation; got '${turn.role}'`,
    );
  }

  const householdId = turn.household_id as HouseholdId;

  // --- Whisper mode: skip all mem.* writes ---------------------------
  if (turn.no_memory_write === true) {
    log.info('enrich_conversation: whisper mode — skipping extraction', {
      turn_id: turn.id,
    });
    return;
  }

  // --- Extractor wiring ----------------------------------------------
  if (!deps.modelClient && !deps.extractor) {
    // No model client and no injected extractor — we cannot extract.
    // DLQ so operators notice; the queue is not usable in this config.
    throw new Error('enrich_conversation: no modelClient and no extractor injected');
  }
  const extractor =
    deps.extractor ?? createConversationExtractor({ modelClient: deps.modelClient!, log });

  // --- Build inputs ---------------------------------------------------
  const [tail, knownPeople] = await Promise.all([
    loadConversationTail(supabase, turn.conversation_id, turn.id),
    loadKnownPeople(supabase, householdId),
  ]);

  const authorDisplay = turn.author_member_id
    ? await loadMemberDisplay(supabase, turn.author_member_id)
    : undefined;

  // --- Call extractor -------------------------------------------------
  let extraction: ConversationExtractionResult;
  try {
    extraction = await extractor.extract({
      turn: {
        id: turn.id,
        body: turn.body_md,
        ...(authorDisplay ? { authorDisplay } : {}),
        createdAt: turn.created_at,
      },
      tail,
      householdId,
      householdContext: `Household ${householdId}`,
      knownPeople,
    });
  } catch (err) {
    throw new Error(
      `conversation extractor failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // --- Write candidates + rules --------------------------------------
  const touchedNodeIds = new Set<string>();
  const newlyCreatedNodeIds = new Set<string>();
  const candidateIds: string[] = [];

  if (extraction.facts.length > 0 || extraction.rules.length > 0) {
    const resolver = createNodeResolver({
      supabase,
      householdId,
      log,
      newlyCreatedNodeIds,
    });

    // Facts → mem.fact_candidate (source='member', status='pending').
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
              source_type: 'conversation',
              source_id: turn.id,
              note: fact.evidence,
              prompt_version: CONVERSATION_EXTRACTOR_PROMPT_VERSION,
              qualifier: fact.qualifier ?? null,
            },
          ] as unknown as Json,
          valid_from: validFromIso,
          valid_to: fact.valid_to ?? null,
          recorded_at: now.toISOString(),
          source: 'member',
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
        candidateIds.push(candRow.id as string);
        touchedNodeIds.add(subjectNodeId);
        if (objectNodeId) touchedNodeIds.add(objectNodeId);
      } catch (err) {
        log.warn('enrich_conversation: fact candidate write failed; skipping', {
          fact_id: fact.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Rules → mem.rule (direct; member-sourced by construction).
    for (const rule of extraction.rules) {
      try {
        if (!turn.author_member_id) {
          log.warn('enrich_conversation: rule skipped — turn has no author_member_id', {
            rule_id: rule.id,
          });
          continue;
        }
        const insert: Database['mem']['Tables']['rule']['Insert'] = {
          household_id: householdId,
          author_member_id: turn.author_member_id,
          description: rule.description,
          predicate_dsl: rule.predicate_dsl as unknown as Json,
          active: true,
        };
        const { error: ruleErr } = await supabase.schema('mem').from('rule').insert(insert);
        if (ruleErr) {
          throw new Error(`mem.rule insert failed: ${ruleErr.message}`);
        }
      } catch (err) {
        log.warn('enrich_conversation: rule write failed; skipping', {
          rule_id: rule.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Reconcile every new candidate inline.
    for (const candidateId of candidateIds) {
      try {
        const result = await reconcileCandidate({ supabase, log, now: () => now }, candidateId);
        for (const nodeId of result.touchedNodeIds) touchedNodeIds.add(nodeId);
      } catch (err) {
        log.warn('enrich_conversation: reconcile failed; candidate stays pending', {
          candidate_id: candidateId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // --- Enqueue node_regen + embed_node for affected nodes ------------
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
      log.warn('enrich_conversation: node_regen enqueue failed', {
        node_id: nodeId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
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
      log.warn('enrich_conversation: embed_node enqueue failed', {
        node_id: nodeId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // --- Audit ---------------------------------------------------------
  await writeAudit(supabase, {
    household_id: householdId,
    action: 'mem.conversation.extracted',
    resource_id: turn.id,
    before: null,
    after: {
      extraction: {
        facts: extraction.facts.length,
        rules: extraction.rules.length,
        candidates_written: candidateIds.length,
        new_nodes: newlyCreatedNodeIds.size,
      },
      prompt_version: CONVERSATION_EXTRACTOR_PROMPT_VERSION,
    },
  });

  log.info('conversation turn extracted', {
    turn_id: turn.id,
    facts: extraction.facts.length,
    rules: extraction.rules.length,
    candidates: candidateIds.length,
  });
}

// ---- Helpers ----------------------------------------------------------

async function loadTurn(
  supabase: SupabaseClient<Database>,
  householdId: string,
  id: string,
): Promise<TurnRow | null> {
  const { data, error } = await supabase
    .schema('app')
    .from('conversation_turn')
    .select('*')
    .eq('id', id)
    .eq('household_id', householdId)
    .maybeSingle();
  if (error) throw new Error(`app.conversation_turn lookup failed: ${error.message}`);
  return data;
}

async function loadConversationTail(
  supabase: SupabaseClient<Database>,
  conversationId: string,
  excludeTurnId: string,
): Promise<
  Array<{
    id: string;
    role: 'member' | 'assistant';
    body: string;
    createdAt: string;
  }>
> {
  const { data, error } = await supabase
    .schema('app')
    .from('conversation_turn')
    .select('id, role, body_md, created_at')
    .eq('conversation_id', conversationId)
    .neq('id', excludeTurnId)
    .in('role', ['member', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(MAX_TAIL_TURNS);
  if (error) throw new Error(`app.conversation_turn tail lookup failed: ${error.message}`);
  const rows = (data ?? []).map((r) => ({
    id: r.id as string,
    role: r.role as 'member' | 'assistant',
    body: r.body_md as string,
    createdAt: r.created_at as string,
  }));
  // Return in chronological order.
  rows.reverse();
  return rows;
}

async function loadKnownPeople(
  supabase: SupabaseClient<Database>,
  householdId: HouseholdId,
): Promise<KnownPerson[]> {
  const { data, error } = await supabase
    .schema('mem')
    .from('node')
    .select('id, canonical_name')
    .eq('household_id', householdId)
    .eq('type', 'person')
    .limit(MAX_KNOWN_PEOPLE);
  if (error) throw new Error(`mem.node people lookup failed: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id as string, name: r.canonical_name as string }));
}

async function loadMemberDisplay(
  supabase: SupabaseClient<Database>,
  memberId: string,
): Promise<string | undefined> {
  const { data, error } = await supabase
    .schema('app')
    .from('member')
    .select('display_name')
    .eq('id', memberId)
    .maybeSingle();
  if (error) return undefined;
  return (data?.display_name as string | undefined) ?? undefined;
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
      resource_type: 'app.conversation_turn',
      resource_id: input.resource_id,
      before: input.before as Json,
      after: input.after as Json,
    });
  if (error) {
    console.warn(`[worker-enrichment] conversation audit write failed: ${error.message}`);
  }
}

// ---- Node resolver (local clone of the event handler's pattern) ------

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
        opts.log.warn('resolver: node lookup failed', { error: exErr.message });
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
        opts.log.warn('resolver: alias lookup failed', { error: aliasErr.message });
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
        metadata: { created_by: 'enrichment.conversation', reference: ref } as unknown as Json,
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
