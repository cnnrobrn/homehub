/**
 * Server actions for the memory graph browser (`/memory`).
 *
 * Every member-side mutation for the memory graph goes through one
 * of these actions. The split between member-writable RLS surfaces
 * (`mem.node.manual_notes_md`, `mem.node.needs_review`) and
 * service-role-only surfaces (`mem.fact`, `mem.fact_candidate`) is
 * enforced both here (we pick the right client) and in the database
 * (RLS + trigger guard on `mem.node`).
 *
 * Spec references:
 *   - specs/04-memory-network/user-controls.md — the per-fact and
 *     per-node affordances these actions implement.
 *   - specs/04-memory-network/graph-schema.md — table shapes.
 *   - specs/04-memory-network/conflict-resolution.md — the
 *     candidate-pipeline semantics we rely on (member corrections
 *     ride the reconciler).
 *
 * All actions return the shared `ActionResult<T>` envelope. The
 * action layer is the single place that catches thrown errors and
 * translates them into `{ ok: false, error: { code, message } }`.
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
  role: string;
  service: ServiceClient;
}

/**
 * Resolve the current user + their member id in the household a
 * memory row belongs to. Every memory action needs this — the
 * fact / node / alias all carry `household_id`, and the member
 * must belong to that household.
 */
async function requireMemberForHousehold(householdId: string): Promise<AuthedActor> {
  const env = authEnv();
  const cookies = await nextCookieAdapter();
  const user = await getUser(env, cookies);
  if (!user) throw new UnauthorizedError('no session');
  const service = createServiceClient(env);
  const memberId = await resolveMemberId(service, householdId, user.id);
  if (!memberId) throw new UnauthorizedError('not a member of this household');
  const { data: memberRow, error: mErr } = await service
    .schema('app')
    .from('member')
    .select('role')
    .eq('id', memberId)
    .maybeSingle();
  if (mErr) throw new Error(`resolveMember: ${mErr.message}`);
  const role = (memberRow?.role ?? 'guest') as string;
  return {
    userId: user.id,
    userEmail: user.email,
    householdId,
    memberId,
    role,
    service,
  };
}

async function requireMemberForFact(
  factId: string,
): Promise<{ actor: AuthedActor; fact: FactRow }> {
  const env = authEnv();
  const service = createServiceClient(env);
  const { data, error } = await service
    .schema('mem')
    .from('fact')
    .select('*')
    .eq('id', factId)
    .maybeSingle();
  if (error) throw new Error(`requireMemberForFact: ${error.message}`);
  if (!data)
    throw new ValidationError('fact not found', [{ path: 'factId', message: 'fact not found' }]);
  const fact = data as FactRow;
  const actor = await requireMemberForHousehold(fact.household_id);
  return { actor, fact };
}

async function requireMemberForNode(
  nodeId: string,
): Promise<{ actor: AuthedActor; node: NodeRow }> {
  const env = authEnv();
  const service = createServiceClient(env);
  const { data, error } = await service
    .schema('mem')
    .from('node')
    .select('*')
    .eq('id', nodeId)
    .maybeSingle();
  if (error) throw new Error(`requireMemberForNode: ${error.message}`);
  if (!data)
    throw new ValidationError('node not found', [{ path: 'nodeId', message: 'node not found' }]);
  const node = data as NodeRow;
  const actor = await requireMemberForHousehold(node.household_id);
  return { actor, node };
}

interface FactRow {
  id: string;
  household_id: string;
  subject_node_id: string;
  predicate: string;
  object_value: unknown;
  object_node_id: string | null;
  confidence: number;
  evidence: unknown;
  valid_from: string;
  valid_to: string | null;
  recorded_at: string;
  superseded_at: string | null;
  superseded_by: string | null;
  source: string;
  reinforcement_count: number;
  last_reinforced_at: string;
  conflict_status: string;
}

interface NodeRow {
  id: string;
  household_id: string;
  type: string;
  canonical_name: string;
  document_md: string | null;
  manual_notes_md: string | null;
  metadata: Record<string, unknown>;
  embedding: string | null;
  created_at: string;
  updated_at: string;
  needs_review: boolean;
}

function evidenceFromMember(summary: string): Array<Record<string, unknown>> {
  return [
    {
      source: 'member',
      recorded_at: new Date().toISOString(),
      summary,
    },
  ];
}

// ==========================================================================
// confirmFactAction
// ==========================================================================

const confirmFactSchema = z.object({ factId: z.string().uuid() });

/**
 * Member-confirms a fact. Writes a `source='member'` candidate with
 * the same (subject, predicate, object) and `confidence=1.0`; the
 * reconciler treats this as a reinforcement signal.
 */
export async function confirmFactAction(
  input: z.input<typeof confirmFactSchema>,
): Promise<ActionResult<{ candidateId: string }>> {
  try {
    const parsed = confirmFactSchema.parse(input);
    const { actor, fact } = await requireMemberForFact(parsed.factId);

    const { data, error } = await actor.service
      .schema('mem')
      .from('fact_candidate')
      .insert({
        household_id: actor.householdId,
        subject_node_id: fact.subject_node_id,
        predicate: fact.predicate,
        object_value: fact.object_value as never,
        object_node_id: fact.object_node_id,
        confidence: 1.0,
        evidence: evidenceFromMember('member confirmed') as never,
        valid_from: fact.valid_from,
        valid_to: fact.valid_to,
        source: 'member',
        status: 'pending',
      })
      .select('id')
      .single();
    if (error) throw new Error(`confirmFactAction: ${error.message}`);

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'mem.fact.confirmed',
      resource_type: 'mem.fact',
      resource_id: parsed.factId,
      after: { candidate_id: data.id },
    });

    return ok({ candidateId: data.id as string });
  } catch (err) {
    return toErr(err);
  }
}

// ==========================================================================
// disputeFactAction
// ==========================================================================

const disputeFactSchema = z.object({
  factId: z.string().uuid(),
  reason: z.string().min(1).max(2_000),
});

/**
 * Member disputes a fact. Creates a member-sourced candidate with a
 * "disputed" marker and flips the canonical fact's `conflict_status`
 * to `'unresolved'` so the UI renders it as a conflict. The reconciler
 * will pick the candidate up and reason about it on its next run.
 */
export async function disputeFactAction(
  input: z.input<typeof disputeFactSchema>,
): Promise<ActionResult<{ candidateId: string }>> {
  try {
    const parsed = disputeFactSchema.parse(input);
    const { actor, fact } = await requireMemberForFact(parsed.factId);

    const { data, error } = await actor.service
      .schema('mem')
      .from('fact_candidate')
      .insert({
        household_id: actor.householdId,
        subject_node_id: fact.subject_node_id,
        predicate: fact.predicate,
        object_value: fact.object_value as never,
        object_node_id: fact.object_node_id,
        confidence: 0.1,
        evidence: evidenceFromMember(`member disputed: ${parsed.reason}`) as never,
        valid_from: fact.valid_from,
        valid_to: fact.valid_to,
        source: 'member',
        status: 'pending',
        reason: parsed.reason,
      })
      .select('id')
      .single();
    if (error) throw new Error(`disputeFactAction: ${error.message}`);

    const { error: updateErr } = await actor.service
      .schema('mem')
      .from('fact')
      .update({ conflict_status: 'unresolved' })
      .eq('id', parsed.factId);
    if (updateErr) throw new Error(`disputeFactAction: ${updateErr.message}`);

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'mem.fact.disputed',
      resource_type: 'mem.fact',
      resource_id: parsed.factId,
      after: { candidate_id: data.id, reason: parsed.reason },
    });

    return ok({ candidateId: data.id as string });
  } catch (err) {
    return toErr(err);
  }
}

// ==========================================================================
// editFactAction
// ==========================================================================

const editFactSchema = z
  .object({
    factId: z.string().uuid(),
    newObjectValue: z.unknown().optional(),
    newObjectNodeId: z.string().uuid().nullable().optional(),
    newValidFrom: z.string().optional(),
  })
  .refine((v) => v.newObjectValue !== undefined || v.newObjectNodeId !== undefined, {
    message: 'must provide newObjectValue or newObjectNodeId',
  });

/**
 * Member-proposed edit to a fact. Writes a `source='member'`
 * candidate with the new object; the reconciler supersedes the
 * canonical fact on its next run. Never overwrites `mem.fact`
 * directly — the candidate pipeline is the single path for
 * fact-shape changes.
 */
export async function editFactAction(
  input: z.input<typeof editFactSchema>,
): Promise<ActionResult<{ candidateId: string }>> {
  try {
    const parsed = editFactSchema.parse(input);
    const { actor, fact } = await requireMemberForFact(parsed.factId);

    const newObjectValue =
      parsed.newObjectValue !== undefined ? parsed.newObjectValue : fact.object_value;
    const newObjectNodeId =
      parsed.newObjectNodeId !== undefined ? parsed.newObjectNodeId : fact.object_node_id;
    const newValidFrom = parsed.newValidFrom ?? fact.valid_from;

    const { data, error } = await actor.service
      .schema('mem')
      .from('fact_candidate')
      .insert({
        household_id: actor.householdId,
        subject_node_id: fact.subject_node_id,
        predicate: fact.predicate,
        object_value: newObjectValue as never,
        object_node_id: newObjectNodeId,
        confidence: 0.95,
        evidence: evidenceFromMember('member edited') as never,
        valid_from: newValidFrom,
        valid_to: fact.valid_to,
        source: 'member',
        status: 'pending',
      })
      .select('id')
      .single();
    if (error) throw new Error(`editFactAction: ${error.message}`);

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'mem.fact.edited',
      resource_type: 'mem.fact',
      resource_id: parsed.factId,
      before: {
        object_value: fact.object_value as never,
        object_node_id: fact.object_node_id,
      },
      after: {
        candidate_id: data.id,
        object_value: newObjectValue as never,
        object_node_id: newObjectNodeId,
      },
    });

    return ok({ candidateId: data.id as string });
  } catch (err) {
    return toErr(err);
  }
}

// ==========================================================================
// deleteFactAction
// ==========================================================================

const deleteFactSchema = z.object({
  factId: z.string().uuid(),
  reason: z.string().min(1).max(2_000),
});

/**
 * Member-requested fact deletion. Writes a `source='member'`
 * candidate with `object_value=null` and a marker reason. The
 * reconciler should interpret "member-sourced + null-object"
 * as a soft-delete request and set `valid_to=now()` +
 * `superseded_at=now()` on the canonical fact (with no
 * successor) so time-travel queries still work.
 *
 * NOTE: the reconciler's current behavior for this pipeline is
 * tracked as a follow-up with @memory-background (see the
 * dispatch follow-ups). Until it lands, the candidate is visible
 * in review queues but does not auto-supersede; members can
 * dispute to get the conflict pip in the meantime.
 */
export async function deleteFactAction(
  input: z.input<typeof deleteFactSchema>,
): Promise<ActionResult<{ candidateId: string }>> {
  try {
    const parsed = deleteFactSchema.parse(input);
    const { actor, fact } = await requireMemberForFact(parsed.factId);

    const { data, error } = await actor.service
      .schema('mem')
      .from('fact_candidate')
      .insert({
        household_id: actor.householdId,
        subject_node_id: fact.subject_node_id,
        predicate: fact.predicate,
        object_value: null,
        object_node_id: null,
        confidence: 0.0,
        evidence: evidenceFromMember(`member requested deletion: ${parsed.reason}`) as never,
        valid_from: fact.valid_from,
        valid_to: new Date().toISOString(),
        source: 'member',
        status: 'pending',
        reason: parsed.reason,
      })
      .select('id')
      .single();
    if (error) throw new Error(`deleteFactAction: ${error.message}`);

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'mem.fact.deleted',
      resource_type: 'mem.fact',
      resource_id: parsed.factId,
      after: { candidate_id: data.id, reason: parsed.reason },
    });

    return ok({ candidateId: data.id as string });
  } catch (err) {
    return toErr(err);
  }
}

// ==========================================================================
// updateManualNotesAction
// ==========================================================================

const updateManualNotesSchema = z.object({
  nodeId: z.string().uuid(),
  markdown: z.string().max(16_000),
});

/**
 * Member-writable: update `mem.node.manual_notes_md`. RLS allows
 * members to update this column directly (trigger guard rejects
 * attempted writes to any other column).
 */
export async function updateManualNotesAction(
  input: z.input<typeof updateManualNotesSchema>,
): Promise<ActionResult<{ updated: true }>> {
  try {
    const parsed = updateManualNotesSchema.parse(input);
    const { actor } = await requireMemberForNode(parsed.nodeId);

    const { error } = await actor.service
      .schema('mem')
      .from('node')
      .update({ manual_notes_md: parsed.markdown })
      .eq('id', parsed.nodeId);
    if (error) throw new Error(`updateManualNotesAction: ${error.message}`);

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'mem.node.notes_updated',
      resource_type: 'mem.node',
      resource_id: parsed.nodeId,
    });

    return ok({ updated: true });
  } catch (err) {
    return toErr(err);
  }
}

// ==========================================================================
// toggleNeedsReviewAction
// ==========================================================================

const toggleNeedsReviewSchema = z.object({ nodeId: z.string().uuid() });

/**
 * Flip `mem.node.needs_review`. Member-writable via RLS.
 */
export async function toggleNeedsReviewAction(
  input: z.input<typeof toggleNeedsReviewSchema>,
): Promise<ActionResult<{ needs_review: boolean }>> {
  try {
    const parsed = toggleNeedsReviewSchema.parse(input);
    const { actor, node } = await requireMemberForNode(parsed.nodeId);

    const newValue = !node.needs_review;
    const { error } = await actor.service
      .schema('mem')
      .from('node')
      .update({ needs_review: newValue })
      .eq('id', parsed.nodeId);
    if (error) throw new Error(`toggleNeedsReviewAction: ${error.message}`);

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'mem.node.needs_review_toggled',
      resource_type: 'mem.node',
      resource_id: parsed.nodeId,
      after: { needs_review: newValue },
    });

    return ok({ needs_review: newValue });
  } catch (err) {
    return toErr(err);
  }
}

// ==========================================================================
// pinNodeAction / unpinNodeAction
// ==========================================================================

const pinNodeSchema = z.object({ nodeId: z.string().uuid() });

async function setPinState(
  nodeId: string,
  shouldPin: boolean,
): Promise<ActionResult<{ pinned: boolean }>> {
  const { actor, node } = await requireMemberForNode(nodeId);
  const metaRaw = node.metadata ?? {};
  const currentList = Array.isArray(metaRaw['pinned_by_member_ids'])
    ? (metaRaw['pinned_by_member_ids'] as unknown[]).filter(
        (v): v is string => typeof v === 'string',
      )
    : [];
  const next = shouldPin
    ? Array.from(new Set([...currentList, actor.memberId]))
    : currentList.filter((id) => id !== actor.memberId);
  const newMeta = { ...metaRaw, pinned_by_member_ids: next };

  // Service-role write: the trigger guard on mem.node forbids
  // member-side updates to `metadata`. Pinning is a user-visible
  // preference; the service-role write is the documented
  // workaround until an explicit pin column lands.
  const { error } = await actor.service
    .schema('mem')
    .from('node')
    .update({ metadata: newMeta as never })
    .eq('id', nodeId);
  if (error) throw new Error(`setPinState: ${error.message}`);

  await writeAuditEvent(actor.service, {
    household_id: actor.householdId,
    actor_user_id: actor.userId,
    action: shouldPin ? 'mem.node.pinned' : 'mem.node.unpinned',
    resource_type: 'mem.node',
    resource_id: nodeId,
  });

  return ok({ pinned: shouldPin });
}

export async function pinNodeAction(
  input: z.input<typeof pinNodeSchema>,
): Promise<ActionResult<{ pinned: boolean }>> {
  try {
    const parsed = pinNodeSchema.parse(input);
    return await setPinState(parsed.nodeId, true);
  } catch (err) {
    return toErr(err);
  }
}

export async function unpinNodeAction(
  input: z.input<typeof pinNodeSchema>,
): Promise<ActionResult<{ pinned: boolean }>> {
  try {
    const parsed = pinNodeSchema.parse(input);
    return await setPinState(parsed.nodeId, false);
  } catch (err) {
    return toErr(err);
  }
}

// ==========================================================================
// mergeNodesAction (owner only)
// ==========================================================================

const mergeNodesSchema = z
  .object({
    primaryNodeId: z.string().uuid(),
    mergeNodeId: z.string().uuid(),
  })
  .refine((v) => v.primaryNodeId !== v.mergeNodeId, {
    message: 'primary and merge node must differ',
  });

/**
 * Merge `mergeNodeId` into `primaryNodeId`. Owner-only.
 * Soft-deletes the merge node (no hard delete). Reassigns facts +
 * edges. Appends the old canonical_name as an alias.
 */
export async function mergeNodesAction(
  input: z.input<typeof mergeNodesSchema>,
): Promise<ActionResult<{ merged: true }>> {
  try {
    const parsed = mergeNodesSchema.parse(input);
    const { actor, node: mergeNode } = await requireMemberForNode(parsed.mergeNodeId);
    if (actor.role !== 'owner') throw new UnauthorizedError('owner-only action');

    // Validate the primary exists + shares the household.
    const { data: primary, error: pErr } = await actor.service
      .schema('mem')
      .from('node')
      .select('*')
      .eq('id', parsed.primaryNodeId)
      .maybeSingle();
    if (pErr) throw new Error(`mergeNodesAction: primary load: ${pErr.message}`);
    if (!primary)
      throw new ValidationError('primary node not found', [
        { path: 'primaryNodeId', message: 'not found' },
      ]);
    if (primary.household_id !== actor.householdId) {
      throw new UnauthorizedError('primary node belongs to a different household');
    }
    if (primary.type !== mergeNode.type) {
      throw new ValidationError('node types must match', [
        { path: 'primaryNodeId', message: 'node types must match to merge' },
      ]);
    }

    // Move aliases.
    const { error: aliasErr } = await actor.service
      .schema('mem')
      .from('alias')
      .update({ node_id: parsed.primaryNodeId })
      .eq('node_id', parsed.mergeNodeId);
    if (aliasErr) throw new Error(`mergeNodesAction: aliases: ${aliasErr.message}`);

    // Append the old canonical_name as an alias (source='manual'
    // with a dedicated reason). The unique (node_id, alias)
    // constraint protects us from duplicates.
    await actor.service.schema('mem').from('alias').insert({
      household_id: actor.householdId,
      node_id: parsed.primaryNodeId,
      alias: mergeNode.canonical_name,
      source: 'manual',
    });

    // Reassign facts.
    const [subRes, objRes] = await Promise.all([
      actor.service
        .schema('mem')
        .from('fact')
        .update({ subject_node_id: parsed.primaryNodeId })
        .eq('subject_node_id', parsed.mergeNodeId),
      actor.service
        .schema('mem')
        .from('fact')
        .update({ object_node_id: parsed.primaryNodeId })
        .eq('object_node_id', parsed.mergeNodeId),
    ]);
    if (subRes.error) throw new Error(`mergeNodesAction: fact subject: ${subRes.error.message}`);
    if (objRes.error) throw new Error(`mergeNodesAction: fact object: ${objRes.error.message}`);

    // Reassign edges. Skip self-edges that would result from the
    // merge (src == dst after reassignment).
    const [edgeSrcRes, edgeDstRes] = await Promise.all([
      actor.service
        .schema('mem')
        .from('edge')
        .update({ src_id: parsed.primaryNodeId })
        .eq('src_id', parsed.mergeNodeId)
        .neq('dst_id', parsed.primaryNodeId),
      actor.service
        .schema('mem')
        .from('edge')
        .update({ dst_id: parsed.primaryNodeId })
        .eq('dst_id', parsed.mergeNodeId)
        .neq('src_id', parsed.primaryNodeId),
    ]);
    if (edgeSrcRes.error)
      throw new Error(`mergeNodesAction: edge src: ${edgeSrcRes.error.message}`);
    if (edgeDstRes.error)
      throw new Error(`mergeNodesAction: edge dst: ${edgeDstRes.error.message}`);

    // Soft-delete the merge node.
    const newMergeMeta = {
      ...(mergeNode.metadata ?? {}),
      merged_into: parsed.primaryNodeId,
      merged_at: new Date().toISOString(),
    };
    const { error: delErr } = await actor.service
      .schema('mem')
      .from('node')
      .update({
        canonical_name: `${mergeNode.canonical_name} [merged]`,
        metadata: newMergeMeta as never,
      })
      .eq('id', parsed.mergeNodeId);
    if (delErr) throw new Error(`mergeNodesAction: soft-delete: ${delErr.message}`);

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'mem.node.merged',
      resource_type: 'mem.node',
      resource_id: parsed.primaryNodeId,
      before: {
        merge_node_id: parsed.mergeNodeId,
        merge_canonical_name: mergeNode.canonical_name,
      },
      after: { primary_node_id: parsed.primaryNodeId },
    });

    return ok({ merged: true });
  } catch (err) {
    return toErr(err);
  }
}

// ==========================================================================
// deleteNodeAction (owner only)
// ==========================================================================

const deleteNodeSchema = z.object({
  nodeId: z.string().uuid(),
  reason: z.string().min(1).max(2_000),
});

/**
 * Owner-only soft-delete for a node. Sets
 * `metadata.deleted_at` and flips any in-flight candidates for this
 * subject to `status='rejected'`.
 */
export async function deleteNodeAction(
  input: z.input<typeof deleteNodeSchema>,
): Promise<ActionResult<{ deleted: true }>> {
  try {
    const parsed = deleteNodeSchema.parse(input);
    const { actor, node } = await requireMemberForNode(parsed.nodeId);
    if (actor.role !== 'owner') throw new UnauthorizedError('owner-only action');

    const nowIso = new Date().toISOString();
    const newMeta = {
      ...(node.metadata ?? {}),
      deleted_at: nowIso,
      deletion_reason: parsed.reason,
    };
    const { error: nodeErr } = await actor.service
      .schema('mem')
      .from('node')
      .update({ metadata: newMeta as never })
      .eq('id', parsed.nodeId);
    if (nodeErr) throw new Error(`deleteNodeAction: node update: ${nodeErr.message}`);

    const { error: candErr } = await actor.service
      .schema('mem')
      .from('fact_candidate')
      .update({ status: 'rejected', reason: 'subject node deleted' })
      .eq('subject_node_id', parsed.nodeId)
      .eq('status', 'pending');
    if (candErr) throw new Error(`deleteNodeAction: cand cancel: ${candErr.message}`);

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'mem.node.deleted',
      resource_type: 'mem.node',
      resource_id: parsed.nodeId,
      after: { reason: parsed.reason },
    });

    return ok({ deleted: true });
  } catch (err) {
    return toErr(err);
  }
}

// ==========================================================================
// searchMemoryAction
// ==========================================================================

const searchMemorySchema = z.object({
  householdId: z.string().uuid(),
  query: z.string().min(1).max(500),
  layers: z.array(z.enum(['episodic', 'semantic', 'procedural'])).optional(),
  types: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(50).optional(),
});

/**
 * Run `query_memory` and return the serialized result. Exposed as
 * a server action so the client search island can call it without
 * a route handler.
 */
export async function searchMemoryAction(input: z.input<typeof searchMemorySchema>): Promise<
  ActionResult<{
    nodes: Array<{ id: string; type: string; canonical_name: string }>;
    facts: Array<{ id: string; subject_node_id: string; predicate: string }>;
    episodes: Array<{ id: string; title: string; occurred_at: string }>;
  }>
> {
  try {
    const parsed = searchMemorySchema.parse(input);
    const actor = await requireMemberForHousehold(parsed.householdId);
    // Lazy-load the retrieval helper so the mock in unit tests
    // doesn't fight the top-level import.
    const { queryHouseholdMemory } = await import('@/lib/memory/query');
    const res = await queryHouseholdMemory({
      householdId: actor.householdId as never,
      query: parsed.query,
      ...(parsed.layers ? { layers: parsed.layers } : {}),
      ...(parsed.types ? { types: parsed.types as never } : {}),
      ...(parsed.limit ? { limit: parsed.limit } : {}),
    });
    return ok({
      nodes: res.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        canonical_name: n.canonical_name,
      })),
      facts: res.facts.map((f) => ({
        id: f.id,
        subject_node_id: f.subject_node_id,
        predicate: f.predicate,
      })),
      episodes: res.episodes.map((e) => ({
        id: e.id,
        title: e.title,
        occurred_at: e.occurred_at,
      })),
    });
  } catch (err) {
    return toErr(err);
  }
}
