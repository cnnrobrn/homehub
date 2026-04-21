/**
 * Handler for the `evaluate_suggestion_approval` pgmq queue.
 *
 * The flow is intentionally minimal:
 *
 *   1. Load the suggestion + its household settings.
 *   2. Resolve the effective policy via `getPolicyFor(kind, settings)`.
 *   3. If `autoApproveWhen?.(suggestion, ctx) === true` (and the
 *      suggestion is still pending), call `approveSuggestion` with
 *      `actorMemberId=null` — writes `suggestion.auto_approved` audit,
 *      flips the row to `approved`.
 *   4. Then dispatch the action (by default, the executor layer takes
 *      over via the normal `execute_action` queue).
 *   5. If the predicate is false (or the policy has none), the
 *      suggestion stays `pending` for a human tap.
 *
 * This sits in the action-executor worker rather than its own service
 * so the runtime surface stays small (one pod, two claim loops).
 *
 * Safety:
 *   - Destructive kinds (deny list) never auto-approve. The check runs
 *     centrally in `getPolicyFor` — we don't re-check here.
 *   - An auto-approval path ONLY runs when `autoApproveWhen` returns
 *     true. If the predicate is missing, nothing happens.
 */

import {
  ApprovalError,
  approveSuggestion,
  dispatchAction,
  getPolicyFor,
  type ApprovalSettings,
  type SuggestionRow,
} from '@homehub/approval-flow';
import {
  queueNames,
  type Logger,
  type QueueClient,
  type ServiceSupabaseClient,
} from '@homehub/worker-runtime';

export interface EvaluateHandlerDeps {
  supabase: ServiceSupabaseClient;
  queues: QueueClient;
  log: Logger;
  now?: () => Date;
}

export async function pollOnceEvaluate(deps: EvaluateHandlerDeps): Promise<'claimed' | 'idle'> {
  const queue = queueNames.evaluateSuggestionApproval;
  const claimed = await deps.queues.claim(queue);
  if (!claimed) return 'idle';

  const log = deps.log.child({
    queue,
    message_id: claimed.messageId,
    household_id: claimed.payload.household_id,
    entity_id: claimed.payload.entity_id,
  });

  try {
    await processOne({ ...deps, log }, claimed.payload.entity_id);
    await deps.queues.ack(queue, claimed.messageId);
    return 'claimed';
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.error('evaluate-handler failed; dead-lettering', { error: reason });
    await deps.queues.deadLetter(queue, claimed.messageId, reason, claimed.payload);
    await deps.queues.ack(queue, claimed.messageId);
    return 'claimed';
  }
}

export async function processOne(
  deps: EvaluateHandlerDeps,
  suggestionId: string,
): Promise<'auto_approved' | 'left_pending' | 'no_op'> {
  const { supabase, log, queues } = deps;
  const now = (deps.now ?? (() => new Date()))();

  const suggestion = await loadSuggestion(supabase, suggestionId);
  if (!suggestion) {
    log.warn('evaluate-handler: suggestion not found; ack', { suggestion_id: suggestionId });
    return 'no_op';
  }
  if (suggestion.status !== 'pending') {
    log.info('evaluate-handler: suggestion not pending; ack', {
      status: suggestion.status,
    });
    return 'no_op';
  }

  const settings = await loadHouseholdApprovalSettings(supabase, suggestion.household_id);
  const policy = getPolicyFor(suggestion.kind, settings);

  if (!policy.autoApproveWhen) {
    log.info('evaluate-handler: no auto-approval policy; leaving pending');
    return 'left_pending';
  }
  const shouldApprove = policy.autoApproveWhen(suggestion, {
    ...(settings ? { settings } : {}),
    now,
  });
  if (!shouldApprove) {
    log.info('evaluate-handler: autoApproveWhen returned false; leaving pending');
    return 'left_pending';
  }

  try {
    const state = await approveSuggestion(
      supabase,
      {
        suggestionId: suggestion.id,
        actorMemberId: null,
        ...(settings ? { settings } : {}),
      },
      { now: () => now },
    );
    log.info('evaluate-handler: auto-approved', {
      suggestion_id: suggestion.id,
      status: state.suggestion.status,
    });
    // Dispatch immediately so the executor layer picks it up. Dispatch
    // logic is the same as the human-approval path; we enqueue
    // `execute_action` via the queues client here since we're in a
    // worker context.
    if (state.suggestion.status === 'approved') {
      await dispatchAction(
        supabase,
        {
          suggestionId: suggestion.id,
          kind: suggestion.kind,
          payload: {
            segment: suggestion.segment,
            preview: suggestion.preview,
          },
          queues,
        },
        { now: () => now },
      );
    }
    return 'auto_approved';
  } catch (err) {
    if (err instanceof ApprovalError && err.code === 'ALREADY_FINALIZED') {
      log.info('evaluate-handler: suggestion finalized by concurrent writer');
      return 'no_op';
    }
    throw err;
  }
}

async function loadSuggestion(
  supabase: ServiceSupabaseClient,
  id: string,
): Promise<SuggestionRow | null> {
  const { data, error } = await supabase
    .schema('app')
    .from('suggestion')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`suggestion lookup failed: ${error.message}`);
  return (data as SuggestionRow | null) ?? null;
}

async function loadHouseholdApprovalSettings(
  supabase: ServiceSupabaseClient,
  householdId: string,
): Promise<ApprovalSettings | undefined> {
  const { data, error } = await supabase
    .schema('app')
    .from('household')
    .select('settings')
    .eq('id', householdId)
    .maybeSingle();
  if (error) {
    // Non-fatal: missing settings means no auto-approval.
    return undefined;
  }
  const settings = (data as { settings: unknown } | null)?.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return undefined;
  return settings as ApprovalSettings;
}
