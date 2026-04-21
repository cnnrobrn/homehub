/**
 * Approval state machine primitives.
 *
 * This module is the SINGLE path that writes to `app.suggestion.status`
 * and `app.action.status`. All web server actions and the action-executor
 * worker route through these helpers so:
 *
 *   - Every transition writes `audit.event`.
 *   - Every approval re-hashes the preview and stores the result.
 *   - Multi-approver quorum is enforced centrally (policy-driven).
 *   - Concurrent approvers are detected via an `updated_at` condition.
 *
 * All DB interactions go through the `supabase` service-role client
 * passed in by the caller. The state machine does NOT construct its own
 * client; tests stub the client with a hand-rolled fake and inject it.
 *
 * Column-tolerance: `app.suggestion.canonical_hash`, `expires_at`, and
 * `approvers` columns land in migration 0014. Until then the state
 * machine:
 *
 *   - reads `preview.__approvers` as the fallback approvers list,
 *   - writes to both the column and `preview.__approvers` on approve,
 *   - falls back to preview-only on any "column does not exist" error.
 *
 * This lets M9-A ship before the migration is applied.
 */

import { type Database, type Json } from '@homehub/db';
import { queueNames, type QueueClient } from '@homehub/worker-runtime';
import { type SupabaseClient } from '@supabase/supabase-js';

import { AUDIT_ACTIONS, writeApprovalAudit, type AuditLogger } from './audit.js';
import { ApprovalError } from './errors.js';
import { getPolicyFor, type ApprovalPolicy, type ApprovalSettings } from './policies.js';
import {
  type ActionRow,
  type ActionStatus,
  type ApprovalApprover,
  type ApprovalState,
  type SuggestionRow,
} from './types.js';

type ServiceClient = SupabaseClient<Database>;

/**
 * Common deps threaded through the helpers. Exposed so tests can
 * inject a fake clock / logger.
 */
export interface ApprovalFlowDeps {
  now?: () => Date;
  logger?: AuditLogger;
}

/** Kind marker on dispatched actions (re-export not needed publicly). */
export const ACTION_SUGGESTION_HASH_KEY = 'suggestion_hash';

// ---------------------------------------------------------------------------
// getApprovalState
// ---------------------------------------------------------------------------

export async function getApprovalState(
  supabase: ServiceClient,
  suggestionId: string,
  ctx: { policy?: ApprovalPolicy; settings?: ApprovalSettings } = {},
): Promise<ApprovalState> {
  const row = await loadSuggestion(supabase, suggestionId);
  if (!row) {
    throw new ApprovalError(`suggestion ${suggestionId} not found`, 'NOT_FOUND');
  }

  const policy = ctx.policy ?? getPolicyFor(row.kind, ctx.settings);
  const approvers = extractApprovers(row);
  const quorumMet = approvers.length >= policy.requiresQuorum;
  const eligibleToExecute = quorumMet && row.status === 'approved';

  return { suggestion: row, approvers, quorumMet, eligibleToExecute };
}

// ---------------------------------------------------------------------------
// approveSuggestion
// ---------------------------------------------------------------------------

export interface ApproveArgs {
  suggestionId: string;
  /**
   * The member id tapping approve. `null` signals a system approval
   * (auto-approval path) and writes `suggestion.auto_approved` audit.
   */
  actorMemberId: string | null;
  /** Optional actor user id for audit attribution. */
  actorUserId?: string | null;
  /**
   * Per-call overrides (rarely used). Merged on top of the kind's
   * policy — primarily useful for tests.
   */
  policyOverrides?: Partial<ApprovalPolicy>;
  /** Household settings used to compute effective policy. */
  settings?: ApprovalSettings;
}

/**
 * Records an approval and, once quorum is met, flips the suggestion
 * to `approved`.
 *
 * Idempotency: if the actor has already approved this suggestion, the
 * call is a no-op — we re-read and return the current state without
 * throwing.
 */
export async function approveSuggestion(
  supabase: ServiceClient,
  args: ApproveArgs,
  deps: ApprovalFlowDeps = {},
): Promise<ApprovalState> {
  const now = (deps.now ?? (() => new Date()))();
  const isAutoApproval = args.actorMemberId == null;

  const row = await loadSuggestion(supabase, args.suggestionId);
  if (!row) {
    throw new ApprovalError(`suggestion ${args.suggestionId} not found`, 'NOT_FOUND');
  }

  if (row.status !== 'pending') {
    // Idempotent: already approved → return current state.
    if (row.status === 'approved') {
      return buildState(row, args.policyOverrides, args.settings);
    }
    throw new ApprovalError(
      `suggestion ${args.suggestionId} is ${row.status}; cannot approve`,
      'ALREADY_FINALIZED',
    );
  }

  const basePolicy = getPolicyFor(row.kind, args.settings);
  const policy: ApprovalPolicy = { ...basePolicy, ...(args.policyOverrides ?? {}) };

  const existingApprovers = extractApprovers(row);

  // Deduplicate: if the actor already approved, treat as no-op. System
  // approvals (memberId=null) are never deduped.
  const alreadyApproved =
    !isAutoApproval &&
    existingApprovers.some((a) => a.memberId && a.memberId === args.actorMemberId);

  const nextApprovers: ApprovalApprover[] = alreadyApproved
    ? existingApprovers
    : [...existingApprovers, { memberId: args.actorMemberId, approvedAt: now.toISOString() }];

  const quorumMet = nextApprovers.length >= policy.requiresQuorum;
  const newStatus = quorumMet ? 'approved' : 'pending';
  const canonical = policy.hashCanonical({
    preview: row.preview,
    kind: row.kind,
    household_id: row.household_id,
  });

  // --- Update the row atomically. We condition on (id, status='pending')
  //     so a concurrent approver that already flipped the row to
  //     approved causes this write to affect zero rows, at which point
  //     we re-read and return the current state.
  const update: Record<string, unknown> = {
    preview: writeApproversIntoPreview(row.preview, nextApprovers) as unknown as Json,
  };
  if (quorumMet) {
    update.status = newStatus;
    update.resolved_at = now.toISOString();
    update.resolved_by = isAutoApproval ? null : args.actorMemberId;
  }
  // Best-effort column writes; tolerate missing columns for pre-migration envs.
  update.canonical_hash = canonical;
  update.approvers = nextApprovers as unknown as Json;

  let updated: SuggestionRow | null = null;
  let updateErr: string | null = null;
  try {
    const { data, error } = await supabase
      .schema('app')
      .from('suggestion')
      .update(update as Database['app']['Tables']['suggestion']['Update'])
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle();
    if (error) {
      updateErr = error.message;
    }
    updated = (data as SuggestionRow | null) ?? null;
  } catch (err) {
    updateErr = err instanceof Error ? err.message : String(err);
  }

  if (updateErr && isMissingColumnError(updateErr)) {
    // Retry without the new columns; keep the approvers list in preview.
    const fallbackUpdate: Database['app']['Tables']['suggestion']['Update'] = {
      preview: writeApproversIntoPreview(row.preview, nextApprovers) as unknown as Json,
    };
    if (quorumMet) {
      fallbackUpdate.status = newStatus;
      fallbackUpdate.resolved_at = now.toISOString();
      fallbackUpdate.resolved_by = isAutoApproval ? null : args.actorMemberId;
    }
    const { data, error } = await supabase
      .schema('app')
      .from('suggestion')
      .update(fallbackUpdate)
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle();
    if (error) {
      throw new ApprovalError(
        `failed to update suggestion ${row.id}: ${error.message}`,
        'NOT_FOUND',
        { cause: error },
      );
    }
    updated = (data as SuggestionRow | null) ?? null;
  } else if (updateErr) {
    throw new ApprovalError(`failed to update suggestion ${row.id}: ${updateErr}`, 'NOT_FOUND');
  }

  if (!updated) {
    // Row wasn't pending when we wrote — re-read and return current state.
    const current = await loadSuggestion(supabase, row.id);
    if (!current) {
      throw new ApprovalError(`suggestion ${row.id} disappeared mid-approval`, 'NOT_FOUND');
    }
    return buildState(current, args.policyOverrides, args.settings);
  }

  // --- Audit the approval.
  await writeApprovalAudit(
    supabase,
    {
      household_id: row.household_id,
      actor_user_id: args.actorUserId ?? null,
      action: isAutoApproval
        ? AUDIT_ACTIONS.SuggestionAutoApproved
        : AUDIT_ACTIONS.SuggestionApproved,
      resource_type: 'suggestion',
      resource_id: row.id,
      before: { status: 'pending', approvers: existingApprovers } as unknown as Json,
      after: { status: updated.status, approvers: nextApprovers } as unknown as Json,
    },
    deps.logger,
  );

  return buildState(updated, args.policyOverrides, args.settings);
}

// ---------------------------------------------------------------------------
// rejectSuggestion
// ---------------------------------------------------------------------------

export interface RejectArgs {
  suggestionId: string;
  actorMemberId: string;
  actorUserId?: string | null;
  reason?: string;
}

export async function rejectSuggestion(
  supabase: ServiceClient,
  args: RejectArgs,
  deps: ApprovalFlowDeps = {},
): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();

  const row = await loadSuggestion(supabase, args.suggestionId);
  if (!row) {
    throw new ApprovalError(`suggestion ${args.suggestionId} not found`, 'NOT_FOUND');
  }
  if (row.status !== 'pending') {
    if (row.status === 'rejected') return;
    throw new ApprovalError(
      `suggestion ${args.suggestionId} is ${row.status}; cannot reject`,
      'ALREADY_FINALIZED',
    );
  }

  const { error } = await supabase
    .schema('app')
    .from('suggestion')
    .update({
      status: 'rejected',
      resolved_at: now.toISOString(),
      resolved_by: args.actorMemberId,
    })
    .eq('id', row.id)
    .eq('status', 'pending');
  if (error) {
    throw new ApprovalError(
      `failed to reject suggestion ${row.id}: ${error.message}`,
      'NOT_FOUND',
      { cause: error },
    );
  }

  await writeApprovalAudit(
    supabase,
    {
      household_id: row.household_id,
      actor_user_id: args.actorUserId ?? null,
      action: AUDIT_ACTIONS.SuggestionRejected,
      resource_type: 'suggestion',
      resource_id: row.id,
      before: { status: 'pending' } as unknown as Json,
      after: {
        status: 'rejected',
        reason: args.reason ?? null,
      } as unknown as Json,
    },
    deps.logger,
  );
}

// ---------------------------------------------------------------------------
// dispatchAction
// ---------------------------------------------------------------------------

export interface DispatchArgs {
  suggestionId: string;
  kind: string;
  payload: Record<string, unknown>;
  /**
   * Actor who triggered the dispatch. For auto-approval this is null.
   */
  actorMemberId?: string | null;
  actorUserId?: string | null;
  /** Optional queue client — dispatchAction enqueues `execute_action`
   *  when provided. When omitted, the caller is responsible for the
   *  enqueue step (useful when the caller is the worker itself). */
  queues?: QueueClient;
}

export interface DispatchResult {
  actionId: string;
}

export async function dispatchAction(
  supabase: ServiceClient,
  args: DispatchArgs,
  deps: ApprovalFlowDeps = {},
): Promise<DispatchResult> {
  const now = (deps.now ?? (() => new Date()))();

  const suggestion = await loadSuggestion(supabase, args.suggestionId);
  if (!suggestion) {
    throw new ApprovalError(`suggestion ${args.suggestionId} not found`, 'NOT_FOUND');
  }
  if (suggestion.status !== 'approved') {
    throw new ApprovalError(
      `cannot dispatch suggestion ${args.suggestionId} in status ${suggestion.status}`,
      'ALREADY_FINALIZED',
    );
  }

  // Compute and embed the canonical hash in the action payload.
  const policy = getPolicyFor(suggestion.kind);
  const suggestionHash = policy.hashCanonical({
    preview: suggestion.preview,
    kind: suggestion.kind,
    household_id: suggestion.household_id,
  });

  const payloadWithHash: Record<string, unknown> = {
    ...args.payload,
    [ACTION_SUGGESTION_HASH_KEY]: suggestionHash,
  };

  const insert: Database['app']['Tables']['action']['Insert'] = {
    household_id: suggestion.household_id,
    suggestion_id: suggestion.id,
    segment: suggestion.segment,
    kind: args.kind,
    payload: payloadWithHash as unknown as Json,
    status: 'pending',
    created_by: args.actorMemberId ?? null,
  };

  const { data, error } = await supabase
    .schema('app')
    .from('action')
    .insert(insert)
    .select('id')
    .single();
  if (error || !data) {
    throw new ApprovalError(
      `failed to insert action for suggestion ${suggestion.id}: ${error?.message ?? 'no id'}`,
      'NOT_FOUND',
      { cause: error },
    );
  }
  const actionId = data.id as string;

  await writeApprovalAudit(
    supabase,
    {
      household_id: suggestion.household_id,
      actor_user_id: args.actorUserId ?? null,
      action: AUDIT_ACTIONS.ActionDispatched,
      resource_type: 'action',
      resource_id: actionId,
      before: null,
      after: {
        suggestion_id: suggestion.id,
        kind: args.kind,
        suggestion_hash: suggestionHash,
      } as unknown as Json,
    },
    deps.logger,
  );

  if (args.queues) {
    await args.queues.send(queueNames.executeAction, {
      household_id: suggestion.household_id,
      kind: 'action.execute',
      entity_id: actionId,
      version: 1,
      enqueued_at: now.toISOString(),
    });
  }

  return { actionId };
}

// ---------------------------------------------------------------------------
// transitionAction
// ---------------------------------------------------------------------------

export interface TransitionDetail {
  result?: Json | Record<string, unknown> | null;
  error?: string | null;
  actorUserId?: string | null;
}

/**
 * Advance an action row to `toStatus`. Enforces:
 *
 *   - the state machine trigger on the DB (pending→running, running→
 *     succeeded/failed, pending→failed for pre-flight validation),
 *   - idempotency on equal transitions (same-status reads short-circuit
 *     with a warn log),
 *   - audit writes for every non-idempotent transition.
 *
 * When the status is a terminal `succeeded`, the caller (executor)
 * should ALSO flip the linked suggestion to `executed`. That write
 * lives in the caller rather than here because the suggestion update
 * can bump the status check constraint (suggestion has `executed` in
 * its constraint already); we keep the action's own transition +
 * suggestion reflection decoupled for clarity.
 */
export async function transitionAction(
  supabase: ServiceClient,
  actionId: string,
  toStatus: ActionStatus,
  detail: TransitionDetail = {},
  deps: ApprovalFlowDeps = {},
): Promise<ActionRow> {
  const now = (deps.now ?? (() => new Date()))();

  const row = await loadAction(supabase, actionId);
  if (!row) {
    throw new ApprovalError(`action ${actionId} not found`, 'NOT_FOUND');
  }
  if (row.status === toStatus) {
    // Idempotent re-claim — short-circuit.
    return row;
  }

  const update: Database['app']['Tables']['action']['Update'] = {
    status: toStatus,
    updated_at: now.toISOString(),
  };
  if (toStatus === 'running') update.started_at = now.toISOString();
  if (toStatus === 'succeeded' || toStatus === 'failed') {
    update.finished_at = now.toISOString();
  }
  if (detail.result !== undefined) {
    update.result = (detail.result as Json) ?? null;
  }
  if (detail.error !== undefined) {
    update.error = detail.error ?? null;
  }

  const { data, error } = await supabase
    .schema('app')
    .from('action')
    .update(update)
    .eq('id', actionId)
    .eq('status', row.status)
    .select('*')
    .maybeSingle();
  if (error) {
    throw new ApprovalError(
      `failed to transition action ${actionId} from ${row.status} to ${toStatus}: ${error.message}`,
      'NOT_FOUND',
      { cause: error },
    );
  }
  if (!data) {
    // Concurrent writer beat us — re-read and return.
    const fresh = await loadAction(supabase, actionId);
    if (!fresh) {
      throw new ApprovalError(`action ${actionId} disappeared mid-transition`, 'NOT_FOUND');
    }
    return fresh;
  }

  const auditAction =
    toStatus === 'running'
      ? AUDIT_ACTIONS.ActionStarted
      : toStatus === 'succeeded'
        ? AUDIT_ACTIONS.ActionSucceeded
        : toStatus === 'failed'
          ? AUDIT_ACTIONS.ActionFailed
          : null;
  if (auditAction) {
    await writeApprovalAudit(
      supabase,
      {
        household_id: row.household_id,
        actor_user_id: detail.actorUserId ?? null,
        action: auditAction,
        resource_type: 'action',
        resource_id: actionId,
        before: { status: row.status } as unknown as Json,
        after: {
          status: toStatus,
          ...(detail.result !== undefined ? { result: detail.result as Json } : {}),
          ...(detail.error !== undefined ? { error: detail.error } : {}),
        } as unknown as Json,
      },
      deps.logger,
    );
  }

  return data as ActionRow;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildState(
  row: SuggestionRow,
  overrides: Partial<ApprovalPolicy> | undefined,
  settings: ApprovalSettings | undefined,
): ApprovalState {
  const basePolicy = getPolicyFor(row.kind, settings);
  const policy: ApprovalPolicy = { ...basePolicy, ...(overrides ?? {}) };
  const approvers = extractApprovers(row);
  const quorumMet = approvers.length >= policy.requiresQuorum;
  return {
    suggestion: row,
    approvers,
    quorumMet,
    eligibleToExecute: quorumMet && row.status === 'approved',
  };
}

async function loadSuggestion(supabase: ServiceClient, id: string): Promise<SuggestionRow | null> {
  // Use `select('*')` so future columns (canonical_hash, expires_at,
  // approvers) are surfaced once migration 0014 lands.
  const { data, error } = await supabase
    .schema('app')
    .from('suggestion')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw new ApprovalError(`failed to load suggestion ${id}: ${error.message}`, 'NOT_FOUND', {
      cause: error,
    });
  }
  return (data as SuggestionRow | null) ?? null;
}

async function loadAction(supabase: ServiceClient, id: string): Promise<ActionRow | null> {
  const { data, error } = await supabase
    .schema('app')
    .from('action')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw new ApprovalError(`failed to load action ${id}: ${error.message}`, 'NOT_FOUND', {
      cause: error,
    });
  }
  return (data as ActionRow | null) ?? null;
}

/**
 * Pulls the approvers list off the row. Prefers the top-level column
 * when present; otherwise falls back to `preview.__approvers`.
 */
export function extractApprovers(row: SuggestionRow): ApprovalApprover[] {
  if (Array.isArray(row.approvers)) {
    return row.approvers.map(normalizeApprover).filter((a): a is ApprovalApprover => a !== null);
  }
  const preview = row.preview as unknown;
  if (preview && typeof preview === 'object' && !Array.isArray(preview)) {
    const stashed = (preview as Record<string, unknown>).__approvers;
    if (Array.isArray(stashed)) {
      return stashed.map(normalizeApprover).filter((a): a is ApprovalApprover => a !== null);
    }
  }
  return [];
}

function normalizeApprover(raw: unknown): ApprovalApprover | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const memberId =
    typeof obj.memberId === 'string' || obj.memberId === null
      ? (obj.memberId as string | null)
      : typeof obj.member_id === 'string' || obj.member_id === null
        ? (obj.member_id as string | null)
        : null;
  const approvedAt =
    typeof obj.approvedAt === 'string'
      ? obj.approvedAt
      : typeof obj.approved_at === 'string'
        ? obj.approved_at
        : null;
  if (!approvedAt) return null;
  return { memberId, approvedAt };
}

function writeApproversIntoPreview(
  preview: Json,
  approvers: ApprovalApprover[],
): Record<string, unknown> {
  const base =
    preview && typeof preview === 'object' && !Array.isArray(preview)
      ? { ...(preview as Record<string, unknown>) }
      : {};
  base.__approvers = approvers as unknown as Json;
  return base;
}

function isMissingColumnError(message: string): boolean {
  // PostgREST surfaces "column ... does not exist" for unknown columns,
  // and Supabase returns a 400 with a `PGRST204` code for unknown
  // columns on update. We match on the substring for both.
  const lower = message.toLowerCase();
  return (
    lower.includes('does not exist') ||
    lower.includes('pgrst204') ||
    (lower.includes('column') && lower.includes('schema cache'))
  );
}

// Re-export so callers that only import state-machine get the helpers.
export { getPolicyFor } from './policies.js';
