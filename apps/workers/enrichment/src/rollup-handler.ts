/**
 * `rollup_conversation` handler (M3.5-B).
 *
 * Consumes `rollup_conversation` pgmq messages emitted by the
 * foreground-agent loop after a substantive assistant turn. Each
 * message's envelope references an `app.conversation` row. The
 * handler:
 *
 *   1. Reads the conversation + its last 15 turns (member + assistant).
 *   2. Substantiveness filter: < 4 turns OR < 120 words → skip + ack.
 *   3. Debounce: if a rollup for this `conversation_id` was written in
 *      the last 10 minutes, skip + ack.
 *   4. Builds the known-people roster.
 *   5. Calls the rollup builder (model + prompt).
 *   6. Resolves `participants` + `place_reference` to `mem.node` ids.
 *   7. Inserts `mem.episode` with `source_type='conversation'`.
 *   8. Enqueues `node_regen` for each participant.
 *   9. Writes an audit row (`mem.conversation.rolled_up`).
 */

import { type Database, type Json } from '@homehub/db';
import {
  CONVERSATION_ROLLUP_PROMPT_VERSION,
  createConversationRollup,
  isConversationSubstantive,
  type ConversationRollup,
  type ConversationRollupResult,
  type KnownPerson,
  type RollupTurn,
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

const MAX_ROLLUP_TURNS = 15;
const MAX_KNOWN_PEOPLE = 50;
const DEBOUNCE_WINDOW_MS = 10 * 60 * 1000;

export interface RollupHandlerDeps {
  supabase: SupabaseClient<Database>;
  queues: QueueClient;
  log: Logger;
  modelClient?: ModelClient;
  rollup?: ConversationRollup;
  now?: () => Date;
}

export async function pollOnceRollup(deps: RollupHandlerDeps): Promise<'claimed' | 'idle'> {
  const queue = queueNames.rollupConversation;
  const claimed = await deps.queues.claim(queue);
  if (!claimed) return 'idle';

  const log = deps.log.child({
    queue,
    message_id: claimed.messageId,
    household_id: claimed.payload.household_id,
    entity_id: claimed.payload.entity_id,
  });

  try {
    await rollupConversationOne({ ...deps, log }, claimed.payload);
    await deps.queues.ack(queue, claimed.messageId);
    return 'claimed';
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.error('rollup_conversation handler failed; dead-lettering', { error: reason });
    await deps.queues.deadLetter(queue, claimed.messageId, reason, claimed.payload);
    await deps.queues.ack(queue, claimed.messageId);
    return 'claimed';
  }
}

export async function rollupConversationOne(
  deps: RollupHandlerDeps,
  envelope: MessageEnvelope,
): Promise<void> {
  const { supabase, log } = deps;
  const now = (deps.now ?? (() => new Date()))();

  const conv = await loadConversation(supabase, envelope.household_id, envelope.entity_id);
  if (!conv) {
    throw new Error(`app.conversation row not found: ${envelope.entity_id}`);
  }
  const householdId = conv.household_id as HouseholdId;

  // --- Load the turn window ------------------------------------------
  const turns = await loadRecentTurns(supabase, conv.id, MAX_ROLLUP_TURNS);
  if (!isConversationSubstantive(turns)) {
    log.info('rollup_conversation: conversation not substantive; skipping', {
      conversation_id: conv.id,
      turns: turns.length,
    });
    return;
  }

  // --- Debounce: skip if a recent rollup already exists --------------
  const existing = await findRecentRollup(supabase, householdId, conv.id, now);
  if (existing) {
    log.info('rollup_conversation: recent rollup exists; debouncing', {
      conversation_id: conv.id,
      existing_episode_id: existing,
    });
    return;
  }

  // --- Rollup wiring --------------------------------------------------
  if (!deps.modelClient && !deps.rollup) {
    throw new Error('rollup_conversation: no modelClient and no rollup injected');
  }
  const rollup = deps.rollup ?? createConversationRollup({ modelClient: deps.modelClient!, log });

  const knownPeople = await loadKnownPeople(supabase, householdId);

  let result: ConversationRollupResult;
  try {
    result = await rollup.build({
      conversationId: conv.id,
      householdId,
      householdContext: `Household ${householdId}`,
      knownPeople,
      turns,
    });
  } catch (err) {
    throw new Error(
      `conversation rollup builder failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // --- Resolve participants + place ----------------------------------
  const newlyCreatedNodeIds = new Set<string>();
  const resolver = createNodeResolver({
    supabase,
    householdId,
    log,
    newlyCreatedNodeIds,
  });
  const participantIds: string[] = [];
  for (const ref of result.participants) {
    try {
      const id = await resolver.resolve(ref, 'person');
      participantIds.push(id);
    } catch (err) {
      log.warn('rollup_conversation: participant resolve failed; skipping', {
        ref,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const placeNodeId = result.place_reference
    ? await resolver.resolve(result.place_reference, 'place').catch((err) => {
        log.warn('rollup_conversation: place resolve failed; skipping', {
          ref: result.place_reference,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      })
    : null;

  // --- Insert mem.episode --------------------------------------------
  const firstTurnId = turns[0]?.id ?? null;
  const lastTurnId = turns[turns.length - 1]?.id ?? null;

  const { data: epRow, error: epErr } = await supabase
    .schema('mem')
    .from('episode')
    .insert({
      household_id: householdId,
      title: result.title,
      summary: result.summary,
      occurred_at: result.occurred_at,
      ended_at: result.ended_at ?? null,
      place_node_id: placeNodeId,
      participants: participantIds,
      source_type: 'conversation',
      source_id: conv.id,
      recorded_at: now.toISOString(),
      metadata: {
        conversation_id: conv.id,
        turn_span: [firstTurnId, lastTurnId],
        version: CONVERSATION_ROLLUP_PROMPT_VERSION,
      } as unknown as Json,
    })
    .select('id')
    .single();
  if (epErr || !epRow) {
    throw new Error(`mem.episode insert failed: ${epErr?.message ?? 'no id'}`);
  }

  // --- Enqueue node_regen for participants + embed_node for new nodes
  for (const nodeId of participantIds) {
    try {
      await deps.queues.send(queueNames.nodeRegen, {
        household_id: householdId,
        kind: 'node.regen',
        entity_id: nodeId,
        version: 1,
        enqueued_at: now.toISOString(),
      });
    } catch (err) {
      log.warn('rollup_conversation: node_regen enqueue failed', {
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
      log.warn('rollup_conversation: embed_node enqueue failed', {
        node_id: nodeId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // --- Audit ---------------------------------------------------------
  await writeAudit(supabase, {
    household_id: householdId,
    action: 'mem.conversation.rolled_up',
    resource_id: conv.id,
    before: null,
    after: {
      episode_id: epRow.id,
      title: result.title,
      participants: participantIds.length,
      turn_span: [firstTurnId, lastTurnId],
      prompt_version: CONVERSATION_ROLLUP_PROMPT_VERSION,
    },
  });

  log.info('conversation rolled up', {
    conversation_id: conv.id,
    episode_id: epRow.id,
    participants: participantIds.length,
    turns: turns.length,
  });
}

// ---- Helpers ----------------------------------------------------------

async function loadConversation(
  supabase: SupabaseClient<Database>,
  householdId: string,
  id: string,
): Promise<Database['app']['Tables']['conversation']['Row'] | null> {
  const { data, error } = await supabase
    .schema('app')
    .from('conversation')
    .select('*')
    .eq('id', id)
    .eq('household_id', householdId)
    .maybeSingle();
  if (error) throw new Error(`app.conversation lookup failed: ${error.message}`);
  return data;
}

async function loadRecentTurns(
  supabase: SupabaseClient<Database>,
  conversationId: string,
  max: number,
): Promise<RollupTurn[]> {
  const { data, error } = await supabase
    .schema('app')
    .from('conversation_turn')
    .select('id, role, body_md, created_at, author_member_id')
    .eq('conversation_id', conversationId)
    .in('role', ['member', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(max);
  if (error) throw new Error(`app.conversation_turn window lookup failed: ${error.message}`);
  const rows = (data ?? []).map(
    (r): RollupTurn => ({
      id: r.id as string,
      role: r.role as 'member' | 'assistant',
      body: r.body_md as string,
      createdAt: r.created_at as string,
    }),
  );
  rows.reverse();
  return rows;
}

async function findRecentRollup(
  supabase: SupabaseClient<Database>,
  householdId: HouseholdId,
  conversationId: string,
  now: Date,
): Promise<string | null> {
  const cutoff = new Date(now.getTime() - DEBOUNCE_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .schema('mem')
    .from('episode')
    .select('id, metadata, recorded_at')
    .eq('household_id', householdId)
    .eq('source_type', 'conversation')
    .eq('source_id', conversationId)
    .gte('recorded_at', cutoff)
    .order('recorded_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`mem.episode debounce lookup failed: ${error.message}`);
  if (!data || data.length === 0) return null;
  return (data[0]!.id as string) ?? null;
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
      resource_type: 'app.conversation',
      resource_id: input.resource_id,
      before: input.before as Json,
      after: input.after as Json,
    });
  if (error) {
    console.warn(`[worker-enrichment] rollup audit write failed: ${error.message}`);
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
        metadata: { created_by: 'rollup.conversation', reference: ref } as unknown as Json,
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
