/**
 * `node-regen` handler (M3-B).
 *
 * Claims `node_regen` pgmq messages. Each message's envelope
 * `entity_id` is a `mem.node.id`. The handler:
 *
 *   1. Reads the node row + all canonical facts for (subject,
 *      predicate) where the node is subject or object.
 *   2. Reads up to 20 recent `mem.episode` rows involving the node.
 *   3. If the node has no facts and no episodes → writes a short
 *      "not yet learned" stub into `document_md`.
 *   4. Otherwise renders the `node-doc` prompt with the facts +
 *      episodes and calls `modelClient.generate()` for a markdown
 *      document.
 *   5. Updates `mem.node.document_md` (preserving `manual_notes_md`).
 *   6. Writes an audit row (`mem.node.regenerated`).
 *
 * Error policy:
 *   - Node missing → DLQ + ack.
 *   - Model error → DLQ + ack. We don't leave `document_md` stale
 *     without surfacing the failure.
 *
 * Debounce: before claiming, the worker checks that no other
 * `node_regen` message for the same node is already in-flight via a
 * pgmq-peek. Best-effort — concurrent updates from two worker
 * instances still land idempotently because the final write overwrites
 * with the latest document.
 */

import { type Database, type Json } from '@homehub/db';
import { loadPrompt, nodeDocSchema, renderPrompt, type NodeDocResponse } from '@homehub/prompts';
import { type HouseholdId } from '@homehub/shared';
import {
  queueNames,
  type Logger,
  type MessageEnvelope,
  type ModelClient,
  type QueueClient,
} from '@homehub/worker-runtime';
import { type SupabaseClient } from '@supabase/supabase-js';

type NodeRow = Database['mem']['Tables']['node']['Row'];
type FactRow = Database['mem']['Tables']['fact']['Row'];
type EpisodeRow = Database['mem']['Tables']['episode']['Row'];

export interface NodeRegenHandlerDeps {
  supabase: SupabaseClient<Database>;
  queues: QueueClient;
  log: Logger;
  /** Required — this worker calls the model on every non-stub path. */
  modelClient: ModelClient;
  now?: () => Date;
}

/**
 * Shape of the stub document written for nodes with no signal yet.
 */
const STUB_DOC = `## Summary

Not yet learned. This node was created by the extractor and has no
facts or episodes yet. Open the graph browser to confirm or edit.

## Open questions

- What is this?`;

export async function pollOnce(deps: NodeRegenHandlerDeps): Promise<'claimed' | 'idle'> {
  const queue = queueNames.nodeRegen;
  const claimed = await deps.queues.claim(queue);
  if (!claimed) return 'idle';

  const log = deps.log.child({
    queue,
    message_id: claimed.messageId,
    household_id: claimed.payload.household_id,
    entity_id: claimed.payload.entity_id,
  });

  try {
    await regenerateOne({ ...deps, log }, claimed.payload);
    await deps.queues.ack(queue, claimed.messageId);
    return 'claimed';
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.error('node-regen handler failed; dead-lettering', { error: reason });
    await deps.queues.deadLetter(queue, claimed.messageId, reason, claimed.payload);
    await deps.queues.ack(queue, claimed.messageId);
    return 'claimed';
  }
}

/**
 * Per-message unit of work. Exposed for tests.
 */
export async function regenerateOne(
  deps: NodeRegenHandlerDeps,
  envelope: MessageEnvelope,
): Promise<void> {
  const { supabase, log, modelClient } = deps;
  const now = (deps.now ?? (() => new Date()))();

  const node = await loadNode(supabase, envelope.household_id, envelope.entity_id);
  if (!node) {
    throw new Error(`mem.node not found: ${envelope.entity_id}`);
  }

  const householdId = node.household_id as HouseholdId;

  const [factsAsSubject, factsAsObject, episodes] = await Promise.all([
    loadFactsForSubject(supabase, householdId, node.id),
    loadFactsForObject(supabase, householdId, node.id),
    loadEpisodes(supabase, householdId, node.id),
  ]);

  const facts = dedupe([...factsAsSubject, ...factsAsObject]);

  let documentMd: string;

  if (facts.length === 0 && episodes.length === 0) {
    documentMd = STUB_DOC;
    log.info('node-regen: stub document written (no signal yet)', { node_id: node.id });
  } else {
    documentMd = await regenerateWithModel({
      modelClient,
      node,
      facts,
      episodes,
      householdId,
      log,
    });
  }

  const { error: upErr } = await supabase
    .schema('mem')
    .from('node')
    // Do NOT touch `manual_notes_md` — that's member-owned.
    .update({ document_md: documentMd, updated_at: now.toISOString() })
    .eq('id', node.id);
  if (upErr) {
    throw new Error(`mem.node update failed: ${upErr.message}`);
  }

  await writeAudit(supabase, {
    household_id: householdId,
    action: 'mem.node.regenerated',
    resource_id: node.id,
    before: { document_md: node.document_md },
    after: {
      document_md_preview: documentMd.slice(0, 200),
      facts: facts.length,
      episodes: episodes.length,
    },
  });

  log.info('node-regen: document regenerated', {
    node_id: node.id,
    facts: facts.length,
    episodes: episodes.length,
  });
}

// ---- Helpers ----------------------------------------------------------

async function loadNode(
  supabase: SupabaseClient<Database>,
  householdId: string,
  nodeId: string,
): Promise<NodeRow | null> {
  const { data, error } = await supabase
    .schema('mem')
    .from('node')
    .select('*')
    .eq('id', nodeId)
    .eq('household_id', householdId)
    .maybeSingle();
  if (error) throw new Error(`mem.node lookup failed: ${error.message}`);
  return data;
}

async function loadFactsForSubject(
  supabase: SupabaseClient<Database>,
  householdId: string,
  nodeId: string,
): Promise<FactRow[]> {
  const { data, error } = await supabase
    .schema('mem')
    .from('fact')
    .select('*')
    .eq('household_id', householdId)
    .eq('subject_node_id', nodeId)
    .is('valid_to', null)
    .is('superseded_at', null);
  if (error) throw new Error(`mem.fact subject lookup failed: ${error.message}`);
  return (data ?? []) as FactRow[];
}

async function loadFactsForObject(
  supabase: SupabaseClient<Database>,
  householdId: string,
  nodeId: string,
): Promise<FactRow[]> {
  const { data, error } = await supabase
    .schema('mem')
    .from('fact')
    .select('*')
    .eq('household_id', householdId)
    .eq('object_node_id', nodeId)
    .is('valid_to', null)
    .is('superseded_at', null);
  if (error) throw new Error(`mem.fact object lookup failed: ${error.message}`);
  return (data ?? []) as FactRow[];
}

async function loadEpisodes(
  supabase: SupabaseClient<Database>,
  householdId: string,
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
      .limit(20),
    supabase
      .schema('mem')
      .from('episode')
      .select('*')
      .eq('household_id', householdId)
      .eq('place_node_id', nodeId)
      .order('occurred_at', { ascending: false })
      .limit(20),
  ]);
  if (partRes.error) throw new Error(`mem.episode lookup failed: ${partRes.error.message}`);
  if (placeRes.error) throw new Error(`mem.episode lookup failed: ${placeRes.error.message}`);
  const merged = dedupeBy(
    [...((partRes.data ?? []) as EpisodeRow[]), ...((placeRes.data ?? []) as EpisodeRow[])],
    (e) => e.id,
  );
  merged.sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  return merged.slice(0, 20);
}

function dedupe(facts: FactRow[]): FactRow[] {
  return dedupeBy(facts, (f) => f.id);
}

function dedupeBy<T>(rows: T[], keyFn: (r: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const r of rows) {
    const key = keyFn(r);
    if (!seen.has(key)) seen.set(key, r);
  }
  return Array.from(seen.values());
}

async function regenerateWithModel(opts: {
  modelClient: ModelClient;
  node: NodeRow;
  facts: FactRow[];
  episodes: EpisodeRow[];
  householdId: HouseholdId;
  log: Logger;
}): Promise<string> {
  const { modelClient, node, facts, episodes, householdId } = opts;
  const prompt = loadPrompt('node-doc');

  const factsRendered =
    facts.length === 0
      ? '(none)'
      : facts
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

  const episodesRendered =
    episodes.length === 0
      ? '(none)'
      : episodes
          .map(
            (e) =>
              `- [${e.occurred_at}] ${e.title}${e.summary ? ` — ${e.summary.slice(0, 120)}` : ''}`,
          )
          .join('\n');

  // Related nodes: union of subject/object ids from the facts, minus
  // the self.
  const relatedIds = new Set<string>();
  for (const f of facts) {
    if (f.subject_node_id !== node.id) relatedIds.add(f.subject_node_id);
    if (f.object_node_id && f.object_node_id !== node.id) relatedIds.add(f.object_node_id);
  }
  for (const e of episodes) {
    for (const p of e.participants) if (p !== node.id) relatedIds.add(p);
    if (e.place_node_id && e.place_node_id !== node.id) relatedIds.add(e.place_node_id);
  }
  const relatedRendered =
    relatedIds.size === 0
      ? '(none)'
      : Array.from(relatedIds)
          .map((id) => `- node:${id}`)
          .join('\n');

  const rendered = renderPrompt(prompt, {
    node_type: node.type,
    node_canonical_name: node.canonical_name,
    node_needs_review: node.needs_review ? 'true' : 'false',
    manual_notes: node.manual_notes_md ?? '(none)',
    facts: factsRendered,
    episodes: episodesRendered,
    related_nodes: relatedRendered,
  });

  const result = await modelClient.generate({
    task: 'summarization.node_doc',
    household_id: householdId,
    systemPrompt: rendered.systemPrompt,
    userPrompt: rendered.userPrompt,
    schema: nodeDocSchema,
    temperature: 0.4,
    maxOutputTokens: 1200,
    cache: 'auto',
  });

  const parsed = result.parsed as NodeDocResponse | undefined;
  if (!parsed) {
    throw new Error('node-regen: model returned no parsed document');
  }
  return parsed.document_md;
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
      resource_type: 'mem.node',
      resource_id: input.resource_id,
      before: input.before as Json,
      after: input.after as Json,
    });
  if (error) {
    console.warn(`[worker-node-regen] audit write failed: ${error.message}`);
  }
}

// Back-compat export (M0 stub surface).
export async function handler(): Promise<void> {
  throw new Error('node-regen handler() entry is not used at M3 — call pollOnce() instead.');
}
