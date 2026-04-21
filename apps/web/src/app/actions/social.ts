/**
 * Server actions for the Social segment UI.
 *
 * - `createGroupAction({ name, memberNodeIds })` — inserts a
 *   `mem.node type='group'` row and a `mem.edge type='part_of'` per
 *   member. Requires migration 0014_social.sql to be deployed so the
 *   `group` node-type is accepted by the check constraint.
 * - `updateGroupAction` / `deleteGroupAction` — rename + soft-delete.
 * - `approveReachOutAction({ suggestionId })` — stubs M9: marks the
 *   suggestion `approved` and records the approver. Execution (drafting
 *   the actual message) is M9's.
 * - `markAsSeenAction({ personNodeId, date? })` — inserts a minimal
 *   `mem.episode` with `source_type='conversation'` so the household
 *   can record a lightweight "we touched base" note from the UI.
 *
 * Every action Zod-validates, catches into `ActionResult<T>`, and
 * writes an `audit.event` row via `writeAuditEvent`. Writes use the
 * service-role client after explicit household-member verification.
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
import { z } from 'zod';

import { type ActionResult, ok, toErr } from './_envelope';

import { nextCookieAdapter } from '@/lib/auth/cookies';
import { authEnv } from '@/lib/auth/env';


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
// createGroupAction
// ==========================================================================

const createGroupSchema = z.object({
  householdId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  memberNodeIds: z.array(z.string().uuid()).max(100),
});

export async function createGroupAction(
  input: z.input<typeof createGroupSchema>,
): Promise<ActionResult<{ groupNodeId: string }>> {
  try {
    const parsed = createGroupSchema.parse(input);
    const actor = await requireMemberForHousehold(parsed.householdId);

    const { data: groupRow, error: insertErr } = await actor.service
      .schema('mem')
      .from('node')
      .insert({
        household_id: actor.householdId,
        type: 'group',
        canonical_name: parsed.name,
        metadata: {
          created_by_member_id: actor.memberId,
        },
        needs_review: false,
      })
      .select('id')
      .single();
    if (insertErr || !groupRow) {
      throw new Error(`createGroupAction: ${insertErr?.message ?? 'no id'}`);
    }

    if (parsed.memberNodeIds.length > 0) {
      const edges = parsed.memberNodeIds.map((memberNodeId) => ({
        household_id: actor.householdId,
        src_id: memberNodeId,
        dst_id: groupRow.id as string,
        type: 'part_of',
        weight: 1.0,
        evidence: [] as unknown[],
      }));
      const { error: edgeErr } = await actor.service
        .schema('mem')
        .from('edge')
        .insert(edges as never);
      if (edgeErr) {
        // Soft-rollback: delete the group node so we don't leak a
        // partial state.
        await actor.service
          .schema('mem')
          .from('node')
          .delete()
          .eq('id', groupRow.id as string);
        throw new Error(`createGroupAction: edge insert failed: ${edgeErr.message}`);
      }
    }

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'mem.group.created',
      resource_type: 'mem.node',
      resource_id: groupRow.id as string,
      after: {
        canonical_name: parsed.name,
        member_node_ids: parsed.memberNodeIds,
      },
    });

    return ok({ groupNodeId: groupRow.id as string });
  } catch (err) {
    return toErr(err);
  }
}

// ==========================================================================
// updateGroupAction
// ==========================================================================

const updateGroupSchema = z.object({
  groupNodeId: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  memberNodeIds: z.array(z.string().uuid()).max(100).optional(),
});

interface GroupShape {
  id: string;
  household_id: string;
  type: string;
  canonical_name: string;
}

export async function updateGroupAction(
  input: z.input<typeof updateGroupSchema>,
): Promise<ActionResult<{ groupNodeId: string }>> {
  try {
    const parsed = updateGroupSchema.parse(input);
    const env = authEnv();
    const service = createServiceClient(env);
    const { data: row, error: loadErr } = await service
      .schema('mem')
      .from('node')
      .select('id, household_id, type, canonical_name')
      .eq('id', parsed.groupNodeId)
      .maybeSingle();
    if (loadErr) throw new Error(`updateGroupAction: ${loadErr.message}`);
    if (!row) {
      throw new ValidationError('group not found', [{ path: 'groupNodeId', message: 'not found' }]);
    }
    const group = row as GroupShape;
    if (group.type !== 'group') {
      throw new ValidationError('node is not a group', [
        { path: 'groupNodeId', message: 'expected type=group' },
      ]);
    }
    const actor = await requireMemberForHousehold(group.household_id);

    if (parsed.name && parsed.name !== group.canonical_name) {
      const { error: renameErr } = await actor.service
        .schema('mem')
        .from('node')
        .update({ canonical_name: parsed.name })
        .eq('id', group.id);
      if (renameErr) throw new Error(`updateGroupAction: rename failed: ${renameErr.message}`);
    }

    if (parsed.memberNodeIds) {
      // Replace membership edges: delete existing, then insert new.
      const { error: delErr } = await actor.service
        .schema('mem')
        .from('edge')
        .delete()
        .eq('household_id', group.household_id)
        .eq('dst_id', group.id)
        .eq('type', 'part_of');
      if (delErr) throw new Error(`updateGroupAction: edge delete failed: ${delErr.message}`);
      if (parsed.memberNodeIds.length > 0) {
        const edges = parsed.memberNodeIds.map((memberNodeId) => ({
          household_id: group.household_id,
          src_id: memberNodeId,
          dst_id: group.id,
          type: 'part_of',
          weight: 1.0,
          evidence: [] as unknown[],
        }));
        const { error: edgeErr } = await actor.service
          .schema('mem')
          .from('edge')
          .insert(edges as never);
        if (edgeErr) throw new Error(`updateGroupAction: edge insert failed: ${edgeErr.message}`);
      }
    }

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'mem.group.updated',
      resource_type: 'mem.node',
      resource_id: group.id,
      after: {
        canonical_name: parsed.name ?? group.canonical_name,
        member_node_ids: parsed.memberNodeIds ?? null,
      },
    });

    return ok({ groupNodeId: group.id });
  } catch (err) {
    return toErr(err);
  }
}

// ==========================================================================
// deleteGroupAction — soft-delete (metadata.deleted_at)
// ==========================================================================

const deleteGroupSchema = z.object({
  groupNodeId: z.string().uuid(),
});

export async function deleteGroupAction(
  input: z.input<typeof deleteGroupSchema>,
): Promise<ActionResult<{ groupNodeId: string }>> {
  try {
    const parsed = deleteGroupSchema.parse(input);
    const env = authEnv();
    const service = createServiceClient(env);
    const { data: row, error: loadErr } = await service
      .schema('mem')
      .from('node')
      .select('id, household_id, type, metadata')
      .eq('id', parsed.groupNodeId)
      .maybeSingle();
    if (loadErr) throw new Error(`deleteGroupAction: ${loadErr.message}`);
    if (!row) {
      throw new ValidationError('group not found', [{ path: 'groupNodeId', message: 'not found' }]);
    }
    const group = row as GroupShape & { metadata: unknown };
    if (group.type !== 'group') {
      throw new ValidationError('node is not a group', [
        { path: 'groupNodeId', message: 'expected type=group' },
      ]);
    }
    const actor = await requireMemberForHousehold(group.household_id);

    const oldMeta =
      group.metadata !== null &&
      typeof group.metadata === 'object' &&
      !Array.isArray(group.metadata)
        ? (group.metadata as Record<string, unknown>)
        : {};
    const merged = { ...oldMeta, deleted_at: new Date().toISOString() };
    const { error: updErr } = await actor.service
      .schema('mem')
      .from('node')
      .update({ metadata: merged as never })
      .eq('id', group.id);
    if (updErr) throw new Error(`deleteGroupAction: ${updErr.message}`);

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'mem.group.deleted',
      resource_type: 'mem.node',
      resource_id: group.id,
      before: { metadata: oldMeta } as never,
      after: { metadata: merged } as never,
    });

    return ok({ groupNodeId: group.id });
  } catch (err) {
    return toErr(err);
  }
}

// ==========================================================================
// approveReachOutAction — M9 stub
// ==========================================================================

const approveReachOutSchema = z.object({
  suggestionId: z.string().uuid(),
});

interface SuggestionShape {
  id: string;
  household_id: string;
  segment: string;
  kind: string;
  status: string;
}

export async function approveReachOutAction(
  input: z.input<typeof approveReachOutSchema>,
): Promise<ActionResult<{ suggestionId: string; status: string }>> {
  try {
    const parsed = approveReachOutSchema.parse(input);
    const env = authEnv();
    const service = createServiceClient(env);
    const { data: row, error: loadErr } = await service
      .schema('app')
      .from('suggestion')
      .select('id, household_id, segment, kind, status')
      .eq('id', parsed.suggestionId)
      .maybeSingle();
    if (loadErr) throw new Error(`approveReachOutAction: ${loadErr.message}`);
    if (!row) {
      throw new ValidationError('suggestion not found', [
        { path: 'suggestionId', message: 'not found' },
      ]);
    }
    const suggestion = row as SuggestionShape;
    if (suggestion.segment !== 'social') {
      throw new ValidationError('not a social suggestion', [
        { path: 'suggestionId', message: 'expected segment=social' },
      ]);
    }
    if (suggestion.status !== 'pending') {
      return ok({ suggestionId: suggestion.id, status: suggestion.status });
    }
    const actor = await requireMemberForHousehold(suggestion.household_id);

    const now = new Date().toISOString();
    const { error: updErr } = await actor.service
      .schema('app')
      .from('suggestion')
      .update({ status: 'approved', resolved_at: now, resolved_by: actor.memberId })
      .eq('id', suggestion.id);
    if (updErr) throw new Error(`approveReachOutAction: ${updErr.message}`);

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'app.suggestion.approved',
      resource_type: 'app.suggestion',
      resource_id: suggestion.id,
      before: { status: 'pending' },
      after: { status: 'approved', resolved_at: now },
    });

    return ok({ suggestionId: suggestion.id, status: 'approved' });
  } catch (err) {
    return toErr(err);
  }
}

// ==========================================================================
// markAsSeenAction — insert a lightweight episode
// ==========================================================================

const markAsSeenSchema = z.object({
  personNodeId: z.string().uuid(),
  householdId: z.string().uuid(),
  note: z.string().trim().max(1_000).optional(),
  occurredAt: z.string().optional(),
});

export async function markAsSeenAction(
  input: z.input<typeof markAsSeenSchema>,
): Promise<ActionResult<{ episodeId: string }>> {
  try {
    const parsed = markAsSeenSchema.parse(input);
    const actor = await requireMemberForHousehold(parsed.householdId);

    // Verify the person node exists and belongs to the same household.
    const { data: node, error: nodeErr } = await actor.service
      .schema('mem')
      .from('node')
      .select('id, household_id, type, canonical_name')
      .eq('id', parsed.personNodeId)
      .maybeSingle();
    if (nodeErr) throw new Error(`markAsSeenAction: ${nodeErr.message}`);
    if (!node) {
      throw new ValidationError('person not found', [
        { path: 'personNodeId', message: 'not found' },
      ]);
    }
    const personNode = node as {
      id: string;
      household_id: string;
      type: string;
      canonical_name: string;
    };
    if (personNode.household_id !== actor.householdId) {
      throw new UnauthorizedError('person belongs to a different household');
    }
    if (personNode.type !== 'person') {
      throw new ValidationError('not a person node', [
        { path: 'personNodeId', message: 'expected type=person' },
      ]);
    }

    const occurredAt = parsed.occurredAt ?? new Date().toISOString();
    const sourceId = `manual-${actor.memberId}-${Date.now()}`;
    const { data: ep, error: epErr } = await actor.service
      .schema('mem')
      .from('episode')
      .insert({
        household_id: actor.householdId,
        title: `Contacted ${personNode.canonical_name}`,
        summary: parsed.note ?? null,
        occurred_at: occurredAt,
        participants: [parsed.personNodeId],
        place_node_id: null,
        source_type: 'conversation',
        source_id: sourceId,
        metadata: {
          recorded_by_member_id: actor.memberId,
          origin: 'manual_mark_as_seen',
        },
      })
      .select('id')
      .single();
    if (epErr || !ep) throw new Error(`markAsSeenAction: ${epErr?.message ?? 'no id'}`);

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'mem.episode.manual_created',
      resource_type: 'mem.episode',
      resource_id: ep.id as string,
      after: {
        person_node_id: parsed.personNodeId,
        occurred_at: occurredAt,
        note: parsed.note ?? null,
      },
    });

    return ok({ episodeId: ep.id as string });
  } catch (err) {
    return toErr(err);
  }
}
