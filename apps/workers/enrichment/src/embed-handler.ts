/**
 * `embed_node` handler (M3.5-B).
 *
 * Consumes `embed_node` pgmq messages emitted by the enrichment and
 * node-regen workers whenever a `mem.node` is created or its
 * `document_md` is regenerated. Delegates the actual work to
 * `embedNodeOne` in `@homehub/enrichment` — this file owns only the
 * claim/ack/DLQ + audit semantics.
 */

import { type Database, type Json } from '@homehub/db';
import { embedNodeOne } from '@homehub/enrichment';
import {
  queueNames,
  type Logger,
  type ModelClient,
  type QueueClient,
} from '@homehub/worker-runtime';
import { type SupabaseClient } from '@supabase/supabase-js';

export interface EmbedHandlerDeps {
  supabase: SupabaseClient<Database>;
  queues: QueueClient;
  log: Logger;
  modelClient?: ModelClient;
}

export async function pollOnceEmbed(deps: EmbedHandlerDeps): Promise<'claimed' | 'idle'> {
  const queue = queueNames.embedNode;
  const claimed = await deps.queues.claim(queue);
  if (!claimed) return 'idle';

  const log = deps.log.child({
    queue,
    message_id: claimed.messageId,
    household_id: claimed.payload.household_id,
    entity_id: claimed.payload.entity_id,
  });

  if (!deps.modelClient) {
    // Without a model client we cannot embed; DLQ so operators notice.
    await deps.queues.deadLetter(
      queue,
      claimed.messageId,
      'no modelClient configured',
      claimed.payload,
    );
    await deps.queues.ack(queue, claimed.messageId);
    return 'claimed';
  }

  try {
    const result = await embedNodeOne(
      { supabase: deps.supabase, modelClient: deps.modelClient, log },
      claimed.payload,
    );
    await writeAudit(deps.supabase, {
      household_id: claimed.payload.household_id,
      action: 'mem.node.embedded',
      resource_id: result.nodeId,
      before: null,
      after: {
        embedded: result.embedded,
        model: result.model ?? null,
        dimensions: result.dimensions ?? null,
      },
    });
    await deps.queues.ack(queue, claimed.messageId);
    return 'claimed';
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.error('embed_node handler failed; dead-lettering', { error: reason });
    await deps.queues.deadLetter(queue, claimed.messageId, reason, claimed.payload);
    await deps.queues.ack(queue, claimed.messageId);
    return 'claimed';
  }
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
    console.warn(`[worker-enrichment] embed audit write failed: ${error.message}`);
  }
}
