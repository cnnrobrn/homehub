/**
 * Executor for the `gift_idea` action kind.
 *
 * Low-stakes: writes a `mem.node` of type `topic` with
 * `canonical_name='Gift idea for <person>'` and
 * `metadata.gift_ideas = [...]`. No external provider call. If a
 * topic node already exists for this person, append to the existing
 * gift-ideas array.
 */

import { type Json } from '@homehub/db';
import { z } from 'zod';

import { coerceRecord, PermanentExecutorError, toPayloadInvalidError } from '../errors.js';
import { type ActionExecutor, type ExecutorDeps } from '../types.js';

export const giftIdeaPayloadSchema = z.object({
  person_node_id: z.string().uuid(),
  person_display_name: z.string().min(1),
  gift_ideas: z.array(z.string()).min(1),
  notes: z.string().optional(),
});

export type GiftIdeaPayload = z.infer<typeof giftIdeaPayloadSchema>;

export interface CreateGiftIdeaExecutorArgs {
  supabase: ExecutorDeps['supabase'];
  now?: () => Date;
}

export function createGiftIdeaExecutor(deps: CreateGiftIdeaExecutorArgs): ActionExecutor {
  const now = deps.now ?? (() => new Date());
  return async ({ action, suggestion, log }) => {
    const payloadCandidate = {
      ...coerceRecord(suggestion.preview),
      ...coerceRecord(action.payload),
    };
    let payload: GiftIdeaPayload;
    try {
      payload = giftIdeaPayloadSchema.parse(payloadCandidate);
    } catch (err) {
      throw toPayloadInvalidError(err);
    }

    const canonicalName = `Gift idea for ${payload.person_display_name}`;
    const stamp = now().toISOString();

    // Look up an existing topic node for the same person / name so we
    // append rather than duplicate.
    const { data: existing, error: readErr } = await deps.supabase
      .schema('mem')
      .from('node')
      .select('id, metadata')
      .eq('household_id', action.household_id)
      .eq('type', 'topic')
      .eq('canonical_name', canonicalName)
      .maybeSingle();
    if (readErr) {
      throw new Error(`mem.node lookup failed: ${readErr.message}`);
    }

    if (existing) {
      const existingMeta = (existing as { metadata: unknown }).metadata ?? {};
      const prior = (existingMeta as { gift_ideas?: unknown }).gift_ideas;
      const priorList = Array.isArray(prior)
        ? prior.filter((v): v is string => typeof v === 'string')
        : [];
      const merged = Array.from(new Set([...priorList, ...payload.gift_ideas]));
      const newMeta: Record<string, unknown> = {
        ...(existingMeta as Record<string, unknown>),
        gift_ideas: merged,
        person_node_id: payload.person_node_id,
      };
      if (payload.notes) newMeta.notes = payload.notes;

      const { error: updErr } = await deps.supabase
        .schema('mem')
        .from('node')
        .update({ metadata: newMeta as unknown as Json, updated_at: stamp })
        .eq('id', (existing as { id: string }).id);
      if (updErr) {
        throw new Error(`mem.node update failed: ${updErr.message}`);
      }
      const topicId = (existing as { id: string }).id;
      log.info('gift_idea appended to existing topic', {
        topic_node_id: topicId,
        new_count: merged.length,
      });
      return {
        result: {
          topic_node_id: topicId,
          gift_ideas: merged,
          appended: true,
        },
      };
    }

    const metadata: Record<string, unknown> = {
      person_node_id: payload.person_node_id,
      gift_ideas: payload.gift_ideas,
    };
    if (payload.notes) metadata.notes = payload.notes;

    const { data: inserted, error: insErr } = await deps.supabase
      .schema('mem')
      .from('node')
      .insert({
        household_id: action.household_id,
        type: 'topic',
        canonical_name: canonicalName,
        metadata: metadata as unknown as Json,
        updated_at: stamp,
      })
      .select('id')
      .single();
    if (insErr || !inserted) {
      throw new Error(`mem.node insert failed: ${insErr?.message ?? 'no row returned'}`);
    }
    const topicId = (inserted as { id: string }).id;
    if (!topicId) {
      throw new PermanentExecutorError(
        'topic_insert_missing_id',
        'mem.node insert did not return an id',
      );
    }
    log.info('gift_idea topic created', { topic_node_id: topicId });
    return {
      result: {
        topic_node_id: topicId,
        gift_ideas: payload.gift_ideas,
        appended: false,
      },
    };
  };
}
