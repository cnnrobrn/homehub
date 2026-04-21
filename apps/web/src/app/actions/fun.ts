/**
 * Server actions for the Fun segment UI.
 *
 * - `createQueueItemAction` — inserts a `mem.node type='topic'` with
 *   `metadata.category='queue_item'` so the member can track
 *   books/shows/games/etc.
 * - `approveOutingIdeaAction` — given an `outing_idea` suggestion,
 *   writes a pending `app.event` with `segment='fun'` and marks the
 *   suggestion as `approved`. The "pending member confirmation" flag
 *   is kept in `metadata.pending_confirmation` until M9 runs the full
 *   approval flow.
 * - `addToTripAction` — sets `app.event.metadata.trip_id` on a child
 *   event so the Fun trip detail view picks it up.
 *
 * Every action Zod-validates at the boundary, catches errors into the
 * shared `ActionResult<T>` envelope, and writes an `app.audit_event`
 * row.
 */

'use server';

import {
  UnauthorizedError,
  ValidationError,
  createServiceClient,
  getUser,
  resolveMemberId,
  writeAuditEvent,
} from '@homehub/auth-server';
import { type Json } from '@homehub/db';
import { z } from 'zod';

import { type ActionResult, ok, toErr } from './_envelope';

import { nextCookieAdapter } from '@/lib/auth/cookies';
import { authEnv } from '@/lib/auth/env';
import { QUEUE_ITEM_CATEGORY } from '@/lib/fun';

type ServiceClient = ReturnType<typeof createServiceClient>;

interface AuthedActor {
  userId: string;
  userEmail: string | null;
  householdId: string;
  memberId: string;
  service: ServiceClient;
}

async function requireMemberForHousehold(householdId: string): Promise<AuthedActor> {
  const env = authEnv();
  const cookies = await nextCookieAdapter();
  const user = await getUser(env, cookies);
  if (!user) throw new UnauthorizedError('no session');
  const service = createServiceClient(env);
  const memberId = await resolveMemberId(service, householdId, user.id);
  if (!memberId) throw new UnauthorizedError('not a member of this household');
  return {
    userId: user.id,
    userEmail: user.email,
    householdId,
    memberId,
    service,
  };
}

// ==========================================================================
// createQueueItemAction
// ==========================================================================

const QUEUE_ITEM_SUBCATEGORIES = ['book', 'show', 'movie', 'game', 'podcast', 'other'] as const;
type QueueItemSubcategory = (typeof QUEUE_ITEM_SUBCATEGORIES)[number];

const createQueueItemSchema = z.object({
  householdId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  subcategory: z.enum(QUEUE_ITEM_SUBCATEGORIES).optional(),
  note: z.string().max(2_000).optional(),
});

export async function createQueueItemAction(
  input: z.input<typeof createQueueItemSchema>,
): Promise<ActionResult<{ id: string; title: string; subcategory: QueueItemSubcategory | null }>> {
  try {
    const parsed = createQueueItemSchema.parse(input);
    const actor = await requireMemberForHousehold(parsed.householdId);

    const metadata: Record<string, unknown> = {
      category: QUEUE_ITEM_CATEGORY,
      created_by_member_id: actor.memberId,
    };
    if (parsed.subcategory) metadata.subcategory = parsed.subcategory;
    if (parsed.note) metadata.note = parsed.note;

    const { data, error } = await actor.service
      .schema('mem')
      .from('node')
      .insert({
        household_id: actor.householdId,
        type: 'topic',
        canonical_name: parsed.title,
        metadata: metadata as unknown as Json,
        needs_review: false,
      })
      .select('id, canonical_name')
      .single();
    if (error || !data) {
      throw new Error(`createQueueItemAction: ${error?.message ?? 'no id'}`);
    }

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'fun.queue_item.created',
      resource_type: 'mem.node',
      resource_id: data.id as string,
      after: {
        title: data.canonical_name,
        subcategory: parsed.subcategory ?? null,
      },
    });

    return ok({
      id: data.id as string,
      title: data.canonical_name as string,
      subcategory: parsed.subcategory ?? null,
    });
  } catch (err) {
    return toErr(err);
  }
}

// ==========================================================================
// approveOutingIdeaAction
// ==========================================================================

const approveOutingIdeaSchema = z.object({
  suggestionId: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
});

export async function approveOutingIdeaAction(
  input: z.input<typeof approveOutingIdeaSchema>,
): Promise<ActionResult<{ suggestionId: string; eventId: string }>> {
  try {
    const parsed = approveOutingIdeaSchema.parse(input);

    const env = authEnv();
    const service = createServiceClient(env);
    const { data: suggestionRow, error: loadErr } = await service
      .schema('app')
      .from('suggestion')
      .select('id, household_id, segment, kind, status, preview, title')
      .eq('id', parsed.suggestionId)
      .maybeSingle();
    if (loadErr) throw new Error(`approveOutingIdeaAction: ${loadErr.message}`);
    if (!suggestionRow) {
      throw new ValidationError('suggestion not found', [
        { path: 'suggestionId', message: 'suggestion not found' },
      ]);
    }
    const suggestion = suggestionRow as {
      id: string;
      household_id: string;
      segment: string;
      kind: string;
      status: string;
      title: string;
      preview: Record<string, unknown> | null;
    };
    if (suggestion.segment !== 'fun' || suggestion.kind !== 'outing_idea') {
      throw new ValidationError('invalid suggestion kind', [
        { path: 'suggestionId', message: 'expected segment=fun kind=outing_idea' },
      ]);
    }
    if (suggestion.status !== 'pending') {
      throw new ValidationError('suggestion already resolved', [
        { path: 'suggestionId', message: `status is ${suggestion.status}` },
      ]);
    }
    const preview = (suggestion.preview ?? {}) as Record<string, unknown>;
    const windowStart =
      typeof preview.window_start === 'string' ? (preview.window_start as string) : null;
    const windowEnd =
      typeof preview.window_end === 'string' ? (preview.window_end as string) : null;
    if (!windowStart) {
      throw new ValidationError('suggestion missing window', [
        { path: 'preview.window_start', message: 'missing' },
      ]);
    }

    const actor = await requireMemberForHousehold(suggestion.household_id);
    const eventTitle = parsed.title?.trim() ?? suggestion.title;

    const eventMetadata: Record<string, unknown> = {
      source_suggestion_id: suggestion.id,
      place_node_id: preview.place_node_id ?? null,
      place_name: preview.place_name ?? null,
      pending_confirmation: true,
    };
    const { data: eventRow, error: insertErr } = await actor.service
      .schema('app')
      .from('event')
      .insert({
        household_id: actor.householdId,
        segment: 'fun',
        kind: 'outing',
        title: eventTitle,
        starts_at: windowStart,
        ends_at: windowEnd,
        all_day: false,
        owner_member_id: actor.memberId,
        metadata: eventMetadata as unknown as Json,
      })
      .select('id')
      .single();
    if (insertErr || !eventRow) {
      throw new Error(`approveOutingIdeaAction: event insert: ${insertErr?.message ?? 'no id'}`);
    }

    const { error: updErr } = await actor.service
      .schema('app')
      .from('suggestion')
      .update({
        status: 'approved',
        resolved_at: new Date().toISOString(),
        resolved_by: actor.memberId,
      })
      .eq('id', suggestion.id);
    if (updErr) {
      // Don't throw: the event is already created. The worker will
      // heal on next run by noticing `status=approved` + matching
      // event id.
      console.warn('approveOutingIdeaAction: suggestion update failed', updErr.message);
    }

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'fun.outing_idea.approved',
      resource_type: 'app.event',
      resource_id: eventRow.id as string,
      after: {
        suggestion_id: suggestion.id,
        window_start: windowStart,
        window_end: windowEnd,
      },
    });

    return ok({
      suggestionId: suggestion.id,
      eventId: eventRow.id as string,
    });
  } catch (err) {
    return toErr(err);
  }
}

// ==========================================================================
// addToTripAction
// ==========================================================================

const addToTripSchema = z.object({
  tripId: z.string().uuid(),
  eventId: z.string().uuid(),
});

export async function addToTripAction(
  input: z.input<typeof addToTripSchema>,
): Promise<ActionResult<{ tripId: string; eventId: string }>> {
  try {
    const parsed = addToTripSchema.parse(input);

    const env = authEnv();
    const service = createServiceClient(env);

    const { data: tripRow, error: tripErr } = await service
      .schema('app')
      .from('event')
      .select('id, household_id, segment, kind, starts_at, ends_at')
      .eq('id', parsed.tripId)
      .maybeSingle();
    if (tripErr) throw new Error(`addToTripAction: trip lookup: ${tripErr.message}`);
    if (!tripRow) {
      throw new ValidationError('trip not found', [{ path: 'tripId', message: 'not found' }]);
    }
    if (tripRow.segment !== 'fun' || tripRow.kind !== 'trip') {
      throw new ValidationError('invalid trip', [
        { path: 'tripId', message: 'expected segment=fun kind=trip' },
      ]);
    }

    const { data: eventRow, error: eventErr } = await service
      .schema('app')
      .from('event')
      .select('id, household_id, metadata')
      .eq('id', parsed.eventId)
      .maybeSingle();
    if (eventErr) throw new Error(`addToTripAction: event lookup: ${eventErr.message}`);
    if (!eventRow) {
      throw new ValidationError('event not found', [{ path: 'eventId', message: 'not found' }]);
    }
    if (eventRow.household_id !== tripRow.household_id) {
      throw new ValidationError('cross-household link forbidden', [
        { path: 'eventId', message: 'household mismatch' },
      ]);
    }

    const actor = await requireMemberForHousehold(tripRow.household_id);

    const existingMeta =
      eventRow.metadata &&
      typeof eventRow.metadata === 'object' &&
      !Array.isArray(eventRow.metadata)
        ? (eventRow.metadata as Record<string, unknown>)
        : {};
    const newMeta = { ...existingMeta, trip_id: parsed.tripId };

    const { error: updErr } = await actor.service
      .schema('app')
      .from('event')
      .update({ metadata: newMeta as unknown as Json })
      .eq('id', parsed.eventId);
    if (updErr) throw new Error(`addToTripAction: update: ${updErr.message}`);

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'fun.event.attached_to_trip',
      resource_type: 'app.event',
      resource_id: parsed.eventId,
      before: { trip_id: (existingMeta.trip_id as string | null | undefined) ?? null } as Json,
      after: { trip_id: parsed.tripId } as Json,
    });

    return ok({ tripId: parsed.tripId, eventId: parsed.eventId });
  } catch (err) {
    return toErr(err);
  }
}
