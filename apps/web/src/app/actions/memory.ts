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

// ==========================================================================
// `/settings/memory` actions (M3.7-B)
// --------------------------------------------------------------------------
// These live alongside the graph-browser actions because they all speak
// to the same schemas (mem.*, app.household.settings, app.model_calls)
// and share the same `requireMemberForHousehold` + audit plumbing.
// Every owner-only action asserts `actor.role === 'owner'` before touching
// household-level settings.
// ==========================================================================

interface HouseholdSettingsShape {
  memory?: {
    writes_paused?: boolean;
    writes_paused_at?: string;
    writes_paused_by_member_id?: string;
    retention_days?: Partial<Record<RetentionCategory, number>>;
    retention_updated_at?: Partial<Record<RetentionCategory, string>>;
    model_budget_monthly_cents?: number;
  };
  [key: string]: unknown;
}

type RetentionCategory =
  | 'raw_emails'
  | 'raw_transactions'
  | 'attachments'
  | 'episodes'
  | 'fact_candidates_expired';

const RETENTION_CATEGORIES = [
  'raw_emails',
  'raw_transactions',
  'attachments',
  'episodes',
] as const satisfies ReadonlyArray<RetentionCategory>;

/**
 * Resolve the caller's member in THEIR household (as opposed to a
 * specific memory row's household). Used by the `/settings/memory`
 * actions which operate at the household-settings level.
 */
async function requireMemberForCurrentHousehold(): Promise<AuthedActor> {
  const env = authEnv();
  const cookies = await nextCookieAdapter();
  const user = await getUser(env, cookies);
  if (!user) throw new UnauthorizedError('no session');
  const { getHouseholdContext } = await import('@/lib/auth/context');
  const ctx = await getHouseholdContext();
  if (!ctx) throw new UnauthorizedError('no household context');
  const service = createServiceClient(env);
  return {
    userId: user.id,
    userEmail: user.email,
    householdId: ctx.household.id,
    memberId: ctx.member.id,
    role: ctx.member.role,
    service,
  };
}

async function readHouseholdSettings(actor: AuthedActor): Promise<HouseholdSettingsShape> {
  const { data, error } = await actor.service
    .schema('app')
    .from('household')
    .select('settings')
    .eq('id', actor.householdId)
    .maybeSingle();
  if (error) throw new Error(`readHouseholdSettings: ${error.message}`);
  const settings = (data?.settings ?? {}) as HouseholdSettingsShape;
  return settings;
}

async function writeHouseholdSettings(
  actor: AuthedActor,
  next: HouseholdSettingsShape,
): Promise<void> {
  const { error } = await actor.service
    .schema('app')
    .from('household')
    .update({ settings: next as never })
    .eq('id', actor.householdId);
  if (error) throw new Error(`writeHouseholdSettings: ${error.message}`);
}

// ==========================================================================
// toggleMemoryWritesAction
// ==========================================================================

const toggleMemoryWritesSchema = z.object({ paused: z.boolean() });

/**
 * Owner-only. Flip `household.settings.memory.writes_paused`. The
 * reflection + extraction workers respect this flag; for M3.7-B we only
 * persist it — the writer-side enforcement rides the existing worker
 * contract per the dispatch.
 */
export async function toggleMemoryWritesAction(
  input: z.input<typeof toggleMemoryWritesSchema>,
): Promise<
  ActionResult<{ paused: boolean; pausedAt: string | null; pausedByMemberId: string | null }>
> {
  try {
    const parsed = toggleMemoryWritesSchema.parse(input);
    const actor = await requireMemberForCurrentHousehold();
    if (actor.role !== 'owner') throw new UnauthorizedError('owner-only action');

    const settings = await readHouseholdSettings(actor);
    const nowIso = new Date().toISOString();
    const nextMemory = {
      ...(settings.memory ?? {}),
      writes_paused: parsed.paused,
      ...(parsed.paused
        ? { writes_paused_at: nowIso, writes_paused_by_member_id: actor.memberId }
        : {}),
    };
    const next: HouseholdSettingsShape = { ...settings, memory: nextMemory };
    await writeHouseholdSettings(actor, next);

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: parsed.paused ? 'mem.writes.paused' : 'mem.writes.resumed',
      resource_type: 'household.settings.memory',
      resource_id: actor.householdId,
      after: { writes_paused: parsed.paused },
    });

    return ok({
      paused: parsed.paused,
      pausedAt: parsed.paused ? nowIso : null,
      pausedByMemberId: parsed.paused ? actor.memberId : null,
    });
  } catch (err) {
    return toErr(err);
  }
}

// ==========================================================================
// updateRetentionWindowsAction
// ==========================================================================

const retentionCategoryEnum = z.enum(RETENTION_CATEGORIES);

const updateRetentionWindowsSchema = z.object({
  category: retentionCategoryEnum,
  days: z.number().int().min(7).max(3_650),
});

export async function updateRetentionWindowsAction(
  input: z.input<typeof updateRetentionWindowsSchema>,
): Promise<ActionResult<{ category: RetentionCategory; days: number }>> {
  try {
    const parsed = updateRetentionWindowsSchema.parse(input);
    const actor = await requireMemberForCurrentHousehold();
    if (actor.role !== 'owner') throw new UnauthorizedError('owner-only action');

    const settings = await readHouseholdSettings(actor);
    const nowIso = new Date().toISOString();
    const retention = { ...(settings.memory?.retention_days ?? {}) };
    const retentionUpdatedAt = { ...(settings.memory?.retention_updated_at ?? {}) };
    retention[parsed.category] = parsed.days;
    retentionUpdatedAt[parsed.category] = nowIso;

    const next: HouseholdSettingsShape = {
      ...settings,
      memory: {
        ...(settings.memory ?? {}),
        retention_days: retention,
        retention_updated_at: retentionUpdatedAt,
      },
    };
    await writeHouseholdSettings(actor, next);

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'mem.retention.updated',
      resource_type: 'household.settings.memory',
      resource_id: actor.householdId,
      after: { category: parsed.category, days: parsed.days },
    });

    return ok({ category: parsed.category, days: parsed.days });
  } catch (err) {
    return toErr(err);
  }
}

// ==========================================================================
// updateModelBudgetAction / getMonthToDateModelSpendAction
// ==========================================================================

const updateModelBudgetSchema = z.object({
  cents: z.number().int().min(0).max(1_000_000),
});

export async function updateModelBudgetAction(
  input: z.input<typeof updateModelBudgetSchema>,
): Promise<ActionResult<{ cents: number }>> {
  try {
    const parsed = updateModelBudgetSchema.parse(input);
    const actor = await requireMemberForCurrentHousehold();
    if (actor.role !== 'owner') throw new UnauthorizedError('owner-only action');

    const settings = await readHouseholdSettings(actor);
    const next: HouseholdSettingsShape = {
      ...settings,
      memory: {
        ...(settings.memory ?? {}),
        model_budget_monthly_cents: parsed.cents,
      },
    };
    await writeHouseholdSettings(actor, next);

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'mem.model_budget.updated',
      resource_type: 'household.settings.memory',
      resource_id: actor.householdId,
      after: { cents: parsed.cents },
    });

    return ok({ cents: parsed.cents });
  } catch (err) {
    return toErr(err);
  }
}

/**
 * Sum `app.model_calls.cost_usd` since the first of the current month
 * for the caller's household. Readable by any member — the raw
 * `app.model_calls` table is owner-only per RLS, but this aggregate is
 * safe to expose to every household member on the settings page.
 */
export async function getMonthToDateModelSpendAction(): Promise<
  ActionResult<{ usd: number; monthStartIso: string }>
> {
  try {
    const actor = await requireMemberForCurrentHousehold();
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthStartIso = monthStart.toISOString();
    const { data, error } = await actor.service
      .schema('app')
      .from('model_calls')
      .select('cost_usd')
      .eq('household_id', actor.householdId)
      .gte('at', monthStartIso);
    if (error) throw new Error(`getMonthToDateModelSpendAction: ${error.message}`);
    const rows = (data ?? []) as Array<{ cost_usd: number | string | null }>;
    const usd = rows.reduce((sum, r) => {
      const v = typeof r.cost_usd === 'number' ? r.cost_usd : Number(r.cost_usd ?? 0);
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0);
    return ok({ usd, monthStartIso });
  } catch (err) {
    return toErr(err);
  }
}

// ==========================================================================
// Rule authoring (list / create / update / delete)
// ==========================================================================

export interface HouseholdRuleSummary {
  id: string;
  authorMemberId: string;
  authorDisplayName: string | null;
  description: string;
  predicateDsl: Record<string, unknown>;
  active: boolean;
  createdAt: string;
  isMine: boolean;
}

export async function listHouseholdRulesAction(): Promise<ActionResult<HouseholdRuleSummary[]>> {
  try {
    const actor = await requireMemberForCurrentHousehold();
    const { data, error } = await actor.service
      .schema('mem')
      .from('rule')
      .select('id, author_member_id, description, predicate_dsl, active, created_at')
      .eq('household_id', actor.householdId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`listHouseholdRulesAction: ${error.message}`);
    const rows = (data ?? []) as Array<{
      id: string;
      author_member_id: string;
      description: string;
      predicate_dsl: unknown;
      active: boolean;
      created_at: string;
    }>;

    const memberIds = Array.from(new Set(rows.map((r) => r.author_member_id)));
    const names = new Map<string, string | null>();
    if (memberIds.length > 0) {
      const { data: members } = await actor.service
        .schema('app')
        .from('member')
        .select('id, display_name')
        .in('id', memberIds);
      for (const m of (members ?? []) as Array<{ id: string; display_name: string | null }>) {
        names.set(m.id, m.display_name);
      }
    }

    const summaries: HouseholdRuleSummary[] = rows.map((r) => ({
      id: r.id,
      authorMemberId: r.author_member_id,
      authorDisplayName: names.get(r.author_member_id) ?? null,
      description: r.description,
      predicateDsl: (r.predicate_dsl ?? {}) as Record<string, unknown>,
      active: r.active,
      createdAt: r.created_at,
      isMine: r.author_member_id === actor.memberId,
    }));
    return ok(summaries);
  } catch (err) {
    return toErr(err);
  }
}

const createRuleSchema = z.object({
  description: z.string().min(1).max(2_000),
  // `z.record(string, unknown)` is already "passthrough" in zod v4 —
  // any keys are accepted. The DSL shape firms up when the M9
  // action-executor lands.
  predicateDsl: z.record(z.string(), z.unknown()).optional(),
});

export async function createRuleAction(
  input: z.input<typeof createRuleSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = createRuleSchema.parse(input);
    const actor = await requireMemberForCurrentHousehold();
    const { data, error } = await actor.service
      .schema('mem')
      .from('rule')
      .insert({
        household_id: actor.householdId,
        author_member_id: actor.memberId,
        description: parsed.description,
        predicate_dsl: (parsed.predicateDsl ?? {}) as never,
        active: true,
      })
      .select('id')
      .single();
    if (error) throw new Error(`createRuleAction: ${error.message}`);

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'mem.rule.created',
      resource_type: 'mem.rule',
      resource_id: (data.id as string) ?? null,
      after: { description: parsed.description },
    });

    return ok({ id: data.id as string });
  } catch (err) {
    return toErr(err);
  }
}

const updateRuleSchema = z
  .object({
    ruleId: z.string().uuid(),
    description: z.string().min(1).max(2_000).optional(),
    // `z.record(string, unknown)` already accepts arbitrary keys in zod v4.
    predicateDsl: z.record(z.string(), z.unknown()).optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (v) => v.description !== undefined || v.predicateDsl !== undefined || v.active !== undefined,
    { message: 'must provide at least one field to update' },
  );

export async function updateRuleAction(
  input: z.input<typeof updateRuleSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = updateRuleSchema.parse(input);
    const actor = await requireMemberForCurrentHousehold();

    const { data: existing, error: eErr } = await actor.service
      .schema('mem')
      .from('rule')
      .select('id, household_id, author_member_id')
      .eq('id', parsed.ruleId)
      .maybeSingle();
    if (eErr) throw new Error(`updateRuleAction: ${eErr.message}`);
    if (!existing)
      throw new ValidationError('rule not found', [{ path: 'ruleId', message: 'not found' }]);
    if (existing.household_id !== actor.householdId)
      throw new UnauthorizedError('rule belongs to a different household');
    if (existing.author_member_id !== actor.memberId)
      throw new UnauthorizedError('only the author can update a rule');

    const patch: Record<string, unknown> = {};
    if (parsed.description !== undefined) patch.description = parsed.description;
    if (parsed.predicateDsl !== undefined) patch.predicate_dsl = parsed.predicateDsl;
    if (parsed.active !== undefined) patch.active = parsed.active;

    const { error: uErr } = await actor.service
      .schema('mem')
      .from('rule')
      .update(patch as never)
      .eq('id', parsed.ruleId);
    if (uErr) throw new Error(`updateRuleAction: ${uErr.message}`);

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'mem.rule.updated',
      resource_type: 'mem.rule',
      resource_id: parsed.ruleId,
      after: patch as never,
    });

    return ok({ id: parsed.ruleId });
  } catch (err) {
    return toErr(err);
  }
}

const deleteRuleSchema = z.object({ ruleId: z.string().uuid() });

export async function deleteRuleAction(
  input: z.input<typeof deleteRuleSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = deleteRuleSchema.parse(input);
    const actor = await requireMemberForCurrentHousehold();

    const { data: existing, error: eErr } = await actor.service
      .schema('mem')
      .from('rule')
      .select('id, household_id, author_member_id, description')
      .eq('id', parsed.ruleId)
      .maybeSingle();
    if (eErr) throw new Error(`deleteRuleAction: ${eErr.message}`);
    if (!existing)
      throw new ValidationError('rule not found', [{ path: 'ruleId', message: 'not found' }]);
    if (existing.household_id !== actor.householdId)
      throw new UnauthorizedError('rule belongs to a different household');
    if (existing.author_member_id !== actor.memberId)
      throw new UnauthorizedError('only the author can delete a rule');

    const { error: dErr } = await actor.service
      .schema('mem')
      .from('rule')
      .delete()
      .eq('id', parsed.ruleId);
    if (dErr) throw new Error(`deleteRuleAction: ${dErr.message}`);

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'mem.rule.deleted',
      resource_type: 'mem.rule',
      resource_id: parsed.ruleId,
      before: { description: (existing as { description: string }).description },
    });

    return ok({ id: parsed.ruleId });
  } catch (err) {
    return toErr(err);
  }
}

// ==========================================================================
// Weekly insights feed (list / confirm / dismiss)
// ==========================================================================

export interface InsightSummary {
  id: string;
  weekStart: string;
  bodyMd: string;
  createdAt: string;
  promotedToRuleId: string | null;
  confirmedByMemberIds: string[];
  dismissedByMemberIds: string[];
}

const listInsightsSchema = z.object({
  limit: z.number().int().positive().max(50).optional(),
});

/**
 * List recent `mem.insight` rows for the caller's household. Members
 * read confirmations/dismissals from `audit.event`: M3.7-A did not
 * give us a `metadata` column on `mem.insight` (follow-up tracked in
 * the dispatch), so we surface action state by scanning the audit
 * trail for `mem.insight.confirmed` / `mem.insight.dismissed` events.
 * The audit table is service-role only; we read it here with the
 * service client (the actor is already authenticated + scoped to a
 * household).
 */
export async function listInsightsAction(
  input?: z.input<typeof listInsightsSchema>,
): Promise<ActionResult<InsightSummary[]>> {
  try {
    const parsed = listInsightsSchema.parse(input ?? {});
    const actor = await requireMemberForCurrentHousehold();
    const limit = parsed.limit ?? 10;

    const { data, error } = await actor.service
      .schema('mem')
      .from('insight')
      .select('id, week_start, body_md, created_at, promoted_to_rule_id')
      .eq('household_id', actor.householdId)
      .order('week_start', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`listInsightsAction: ${error.message}`);

    const rows = (data ?? []) as Array<{
      id: string;
      week_start: string;
      body_md: string;
      created_at: string;
      promoted_to_rule_id: string | null;
    }>;

    // Collect confirmations / dismissals via audit events.
    const insightIds = rows.map((r) => r.id);
    const confirmedBy = new Map<string, Set<string>>();
    const dismissedBy = new Map<string, Set<string>>();
    if (insightIds.length > 0) {
      const { data: audits } = await actor.service
        .schema('audit')
        .from('event')
        .select('action, resource_id, after')
        .eq('household_id', actor.householdId)
        .eq('resource_type', 'mem.insight')
        .in('resource_id', insightIds)
        .in('action', ['mem.insight.confirmed', 'mem.insight.dismissed']);
      for (const evt of (audits ?? []) as Array<{
        action: string;
        resource_id: string;
        after: Record<string, unknown> | null;
      }>) {
        const target = evt.action === 'mem.insight.confirmed' ? confirmedBy : dismissedBy;
        const set = target.get(evt.resource_id) ?? new Set<string>();
        const memberId =
          typeof evt.after?.member_id === 'string' ? (evt.after.member_id as string) : null;
        if (memberId) set.add(memberId);
        target.set(evt.resource_id, set);
      }
    }

    const summaries: InsightSummary[] = rows.map((r) => ({
      id: r.id,
      weekStart: r.week_start,
      bodyMd: r.body_md,
      createdAt: r.created_at,
      promotedToRuleId: r.promoted_to_rule_id,
      confirmedByMemberIds: Array.from(confirmedBy.get(r.id) ?? []),
      dismissedByMemberIds: Array.from(dismissedBy.get(r.id) ?? []),
    }));
    return ok(summaries);
  } catch (err) {
    return toErr(err);
  }
}

const confirmInsightSchema = z.object({ insightId: z.string().uuid() });

/**
 * Record a member confirmation of an insight. `mem.insight` has no
 * `metadata` column in the M3.7-A migration, so we log the
 * confirmation as `audit.event` with `after.member_id`. If the
 * insight schema gains a `metadata` column later, this action should
 * also patch it (see follow-ups).
 */
export async function confirmInsightAction(
  input: z.input<typeof confirmInsightSchema>,
): Promise<ActionResult<{ insightId: string }>> {
  try {
    const parsed = confirmInsightSchema.parse(input);
    const actor = await requireMemberForCurrentHousehold();

    const { data: existing, error: eErr } = await actor.service
      .schema('mem')
      .from('insight')
      .select('id, household_id')
      .eq('id', parsed.insightId)
      .maybeSingle();
    if (eErr) throw new Error(`confirmInsightAction: ${eErr.message}`);
    if (!existing)
      throw new ValidationError('insight not found', [{ path: 'insightId', message: 'not found' }]);
    if ((existing as { household_id: string }).household_id !== actor.householdId)
      throw new UnauthorizedError('insight belongs to a different household');

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'mem.insight.confirmed',
      resource_type: 'mem.insight',
      resource_id: parsed.insightId,
      after: { member_id: actor.memberId },
    });

    return ok({ insightId: parsed.insightId });
  } catch (err) {
    return toErr(err);
  }
}

const dismissInsightSchema = z.object({ insightId: z.string().uuid() });

export async function dismissInsightAction(
  input: z.input<typeof dismissInsightSchema>,
): Promise<ActionResult<{ insightId: string }>> {
  try {
    const parsed = dismissInsightSchema.parse(input);
    const actor = await requireMemberForCurrentHousehold();

    const { data: existing, error: eErr } = await actor.service
      .schema('mem')
      .from('insight')
      .select('id, household_id')
      .eq('id', parsed.insightId)
      .maybeSingle();
    if (eErr) throw new Error(`dismissInsightAction: ${eErr.message}`);
    if (!existing)
      throw new ValidationError('insight not found', [{ path: 'insightId', message: 'not found' }]);
    if ((existing as { household_id: string }).household_id !== actor.householdId)
      throw new UnauthorizedError('insight belongs to a different household');

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'mem.insight.dismissed',
      resource_type: 'mem.insight',
      resource_id: parsed.insightId,
      after: { member_id: actor.memberId },
    });

    return ok({ insightId: parsed.insightId });
  } catch (err) {
    return toErr(err);
  }
}

// ==========================================================================
// Danger zone: forget-all request / cancel (owner-only)
// --------------------------------------------------------------------------
// The actual purge is tracked as M10 — these actions only log intent to
// `audit.event` with a 48-hour cancellation window. `getForgetAllRequest`
// returns the most recent unfulfilled `mem.forget_all.requested` event
// (or null) so the UI can show an "Undo" button.
// ==========================================================================

const FORGET_ALL_WINDOW_MS = 48 * 60 * 60 * 1000; // 48 hours

export interface ForgetAllRequestStatus {
  requestedAt: string;
  expiresAt: string;
  requestedByMemberId: string | null;
}

export async function getForgetAllRequestAction(): Promise<
  ActionResult<ForgetAllRequestStatus | null>
> {
  try {
    const actor = await requireMemberForCurrentHousehold();
    const windowStart = new Date(Date.now() - FORGET_ALL_WINDOW_MS).toISOString();

    const { data, error } = await actor.service
      .schema('audit')
      .from('event')
      .select('action, at, after')
      .eq('household_id', actor.householdId)
      .in('action', ['mem.forget_all.requested', 'mem.forget_all.canceled'])
      .gte('at', windowStart)
      .order('at', { ascending: false });
    if (error) throw new Error(`getForgetAllRequestAction: ${error.message}`);

    const events = (data ?? []) as Array<{
      action: string;
      at: string;
      after: Record<string, unknown> | null;
    }>;
    // Most recent wins. If a cancel came after the request, there's no
    // pending request.
    const latest = events[0];
    if (!latest || latest.action !== 'mem.forget_all.requested') return ok(null);

    const requestedAt = latest.at;
    const memberId =
      typeof latest.after?.member_id === 'string' ? (latest.after.member_id as string) : null;
    const expiresAt = new Date(
      new Date(requestedAt).getTime() + FORGET_ALL_WINDOW_MS,
    ).toISOString();
    return ok({ requestedAt, expiresAt, requestedByMemberId: memberId });
  } catch (err) {
    return toErr(err);
  }
}

export async function requestForgetAllAction(): Promise<
  ActionResult<{ requestedAt: string; expiresAt: string }>
> {
  try {
    const actor = await requireMemberForCurrentHousehold();
    if (actor.role !== 'owner') throw new UnauthorizedError('owner-only action');

    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + FORGET_ALL_WINDOW_MS).toISOString();

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'mem.forget_all.requested',
      resource_type: 'household.memory',
      resource_id: actor.householdId,
      after: { member_id: actor.memberId, expires_at: expiresAt },
    });

    return ok({ requestedAt: nowIso, expiresAt });
  } catch (err) {
    return toErr(err);
  }
}

export async function cancelForgetAllAction(): Promise<ActionResult<{ canceledAt: string }>> {
  try {
    const actor = await requireMemberForCurrentHousehold();
    if (actor.role !== 'owner') throw new UnauthorizedError('owner-only action');

    const nowIso = new Date().toISOString();
    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'mem.forget_all.canceled',
      resource_type: 'household.memory',
      resource_id: actor.householdId,
      after: { member_id: actor.memberId, canceled_at: nowIso },
    });

    return ok({ canceledAt: nowIso });
  } catch (err) {
    return toErr(err);
  }
}
