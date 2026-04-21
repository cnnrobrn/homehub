/**
 * `embed_node` handler primitive (M3.5).
 *
 * Populates `mem.node.embedding` after a node is created or its
 * document regenerates. Without this step `mem.node_embedding_ivfflat_idx`
 * is a no-op and the retrieval layer's semantic search falls back to
 * alias/exact lookups only.
 *
 * Composition text (per spec):
 *   canonical_name + ' ' + document_md.slice(0, 2000) + ' ' + aliases.join(' ')
 *
 * Spec anchors: `specs/04-memory-network/graph-schema.md` (embedding
 * column) + `specs/04-memory-network/retrieval.md` (semantic lookups).
 *
 * Error policy:
 *   - Missing node → throw (handler DLQs).
 *   - Empty composed text → short-circuit (no model call, ack) — this
 *     happens for stub nodes with no name, which shouldn't exist but
 *     the schema doesn't require `canonical_name` to be non-empty;
 *     we defend against it.
 *   - Model `embed()` failure → throw (handler DLQs).
 */

import { type Database } from '@homehub/db';
import { type HouseholdId } from '@homehub/shared';
import { type Logger, type ModelClient } from '@homehub/worker-runtime';
import { type SupabaseClient } from '@supabase/supabase-js';

type NodeRow = Database['mem']['Tables']['node']['Row'];

/** Maximum number of characters from document_md included in the embedded text. */
export const EMBED_DOCUMENT_MD_MAX_CHARS = 2000;

export interface EmbedNodeDeps {
  supabase: SupabaseClient<Database>;
  modelClient: ModelClient;
  log: Logger;
}

export interface EmbedNodeResult {
  nodeId: string;
  /** `false` when the composed text was empty and we short-circuited. */
  embedded: boolean;
  /** Model that produced the embedding (when embedded=true). */
  model?: string;
  /** Length of the embedding vector (when embedded=true). */
  dimensions?: number;
}

/**
 * Compose the node's embedding text from its canonical name, truncated
 * document_md, and aliases. Exposed for tests.
 */
export function composeEmbeddingText(args: {
  node: Pick<NodeRow, 'canonical_name' | 'document_md'>;
  aliases: string[];
}): string {
  const name = (args.node.canonical_name ?? '').trim();
  const docMd = (args.node.document_md ?? '').slice(0, EMBED_DOCUMENT_MD_MAX_CHARS).trim();
  const aliases = args.aliases
    .map((a) => a.trim())
    .filter((a) => a.length > 0)
    .join(' ');
  return [name, docMd, aliases]
    .filter((s) => s.length > 0)
    .join(' ')
    .trim();
}

/**
 * Runs one embed_node message. The caller is responsible for claim /
 * ack / DLQ semantics; this function throws on any fatal condition.
 */
export async function embedNodeOne(
  deps: EmbedNodeDeps,
  envelope: { household_id: string; entity_id: string },
): Promise<EmbedNodeResult> {
  const { supabase, modelClient, log } = deps;

  const { data: node, error: nodeErr } = await supabase
    .schema('mem')
    .from('node')
    .select('id, household_id, canonical_name, document_md')
    .eq('id', envelope.entity_id)
    .eq('household_id', envelope.household_id)
    .maybeSingle();
  if (nodeErr) {
    throw new Error(`embed_node: mem.node lookup failed: ${nodeErr.message}`);
  }
  if (!node) {
    throw new Error(`embed_node: mem.node not found: ${envelope.entity_id}`);
  }

  const { data: aliasRows, error: aliasErr } = await supabase
    .schema('mem')
    .from('alias')
    .select('alias')
    .eq('node_id', node.id);
  if (aliasErr) {
    throw new Error(`embed_node: mem.alias lookup failed: ${aliasErr.message}`);
  }
  const aliases = (aliasRows ?? []).map((r) => r.alias as string);

  const text = composeEmbeddingText({
    node: { canonical_name: node.canonical_name, document_md: node.document_md },
    aliases,
  });

  if (text.length === 0) {
    log.warn('embed_node: composed text empty; skipping', { node_id: node.id });
    return { nodeId: node.id, embedded: false };
  }

  const embed = await modelClient.embed({
    text,
    household_id: node.household_id as HouseholdId,
    task: 'embedding.node',
  });

  // Supabase-js stores pgvector as a string-formatted vector literal.
  // The generated type is `string | null`; we send a JSON array and let
  // the driver serialize.
  const { error: upErr } = await supabase
    .schema('mem')
    .from('node')
    .update({ embedding: embed.embedding as unknown as string })
    .eq('id', node.id);
  if (upErr) {
    throw new Error(`embed_node: mem.node update failed: ${upErr.message}`);
  }

  log.info('embed_node: node embedded', {
    node_id: node.id,
    model: embed.model,
    dims: embed.embedding.length,
    text_chars: text.length,
  });

  return {
    nodeId: node.id,
    embedded: true,
    model: embed.model,
    dimensions: embed.embedding.length,
  };
}
