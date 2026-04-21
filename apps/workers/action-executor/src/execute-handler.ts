/**
 * Handler for the `execute_action` pgmq queue.
 *
 * Flow per message:
 *
 *   1. Load the action row (by `entity_id`). Missing → DLQ.
 *   2. Short-circuit: if the action is already `succeeded`, ack + log
 *      (idempotent re-claim). If already `failed`, ack + log.
 *   3. Load the linked suggestion. Missing suggestion_id → DLQ (orphan).
 *   4. Transition action `pending → running` via the approval-flow
 *      state machine (writes `audit.event` action.started).
 *   5. Re-verify the canonical hash of the suggestion against
 *      `action.payload.suggestion_hash`. Mismatch → `failed` with
 *      `TAMPER_DETECTED` + DLQ. The member-approved payload must still
 *      describe the same thing at execution time.
 *   6. Dispatch to the kind-keyed executor registry. M9-A ships with
 *      an empty registry; every kind fails `UnknownActionKindError`
 *      until M9-B populates it.
 *   7. On success: transition `running → succeeded` + flip the
 *      suggestion to `executed`.
 *   8. On failure: transition `running → failed`. Decide DLQ vs
 *      retry based on error shape (see `classifyError`).
 *
 * Error policy:
 *   - `UnknownActionKindError`, `TamperDetectedError`, `OrphanActionError`
 *      → permanent. DLQ + ack.
 *   - `ApprovalError` with `NOT_FOUND` / `ALREADY_FINALIZED` → permanent. DLQ.
 *   - Everything else → transient. nack (exponential back-off via
 *     pgmq's set_vt).
 */

import {
  ACTION_SUGGESTION_HASH_KEY,
  ApprovalError,
  getPolicyFor,
  transitionAction,
  type ActionRow,
  type SuggestionRow,
} from '@homehub/approval-flow';
import { type Database } from '@homehub/db';
import {
  queueNames,
  type Logger,
  type QueueClient,
  type ServiceSupabaseClient,
} from '@homehub/worker-runtime';

import {
  getExecutor,
  OrphanActionError,
  TamperDetectedError,
  UnknownActionKindError,
} from './registry.js';

export interface ExecuteHandlerDeps {
  supabase: ServiceSupabaseClient;
  queues: QueueClient;
  log: Logger;
  /** Default: `() => new Date()`. */
  now?: () => Date;
}

/**
 * Claim one message and process it. Returns `'claimed'` when we pulled
 * a message (so the main loop can immediately poll again) and
 * `'idle'` when the queue was empty.
 */
export async function pollOnceExecute(deps: ExecuteHandlerDeps): Promise<'claimed' | 'idle'> {
  const queue = queueNames.executeAction;
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
    const outcome = classifyError(err);
    log.error('execute-handler failed', {
      error: err instanceof Error ? err.message : String(err),
      code: outcome.code,
      terminal: outcome.terminal,
    });
    if (outcome.terminal) {
      await deps.queues.deadLetter(queue, claimed.messageId, outcome.reason, claimed.payload);
      await deps.queues.ack(queue, claimed.messageId);
    } else {
      await deps.queues.nack(queue, claimed.messageId, {
        ...(outcome.retryDelaySec !== undefined ? { retryDelaySec: outcome.retryDelaySec } : {}),
      });
    }
    return 'claimed';
  }
}

/**
 * Per-message unit of work. Exposed for unit tests so they can exercise
 * the body without the queue client dance.
 */
export async function processOne(
  deps: Omit<ExecuteHandlerDeps, 'queues'> & { queues?: QueueClient },
  actionId: string,
): Promise<void> {
  const { supabase, log } = deps;
  const now = (deps.now ?? (() => new Date()))();

  // --- 1. Load the action row.
  const action = await loadAction(supabase, actionId);
  if (!action) {
    throw new ApprovalError(`action ${actionId} not found`, 'NOT_FOUND');
  }
  const actionLog = log.child({ action_id: action.id, kind: action.kind });

  // --- 2. Short-circuit on terminal states.
  if (action.status === 'succeeded') {
    actionLog.info('execute-handler: action already succeeded; idempotent no-op');
    return;
  }
  if (action.status === 'failed') {
    actionLog.info('execute-handler: action already failed; idempotent no-op');
    return;
  }

  // --- 3. Load the linked suggestion.
  if (!action.suggestion_id) {
    throw new OrphanActionError(action.id);
  }
  const suggestion = await loadSuggestion(supabase, action.suggestion_id);
  if (!suggestion) {
    throw new OrphanActionError(action.id);
  }

  // --- 4. Transition to running (writes audit `action.started`).
  await transitionAction(supabase, action.id, 'running', {}, { now: () => now });

  // --- 5. Verify canonical hash. Read the fresh, post-transition
  //        row via the state machine's helpers.
  const payload = (action.payload ?? {}) as Record<string, unknown>;
  const storedHash = payload[ACTION_SUGGESTION_HASH_KEY];
  const currentHash = getPolicyFor(suggestion.kind).hashCanonical({
    preview: suggestion.preview,
    kind: suggestion.kind,
    household_id: suggestion.household_id,
  });
  if (typeof storedHash !== 'string') {
    await transitionAction(
      supabase,
      action.id,
      'failed',
      { error: 'missing suggestion_hash on action payload' },
      { now: () => now },
    );
    throw new TamperDetectedError(`action ${action.id} payload is missing suggestion_hash`);
  }
  if (storedHash !== currentHash) {
    await transitionAction(
      supabase,
      action.id,
      'failed',
      { error: 'suggestion_hash mismatch' },
      { now: () => now },
    );
    throw new TamperDetectedError(
      `action ${action.id} suggestion_hash does not match current suggestion preview`,
    );
  }

  // --- 6. Dispatch to executor registry.
  let executorResult: unknown;
  try {
    const executor = getExecutor(action.kind);
    const outcome = await executor({
      action,
      suggestion,
      supabase,
      log: actionLog,
    });
    executorResult = outcome.result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await transitionAction(supabase, action.id, 'failed', { error: message }, { now: () => now });
    throw err;
  }

  // --- 7. Transition to succeeded + flip suggestion to executed.
  await transitionAction(
    supabase,
    action.id,
    'succeeded',
    { result: (executorResult ?? null) as never },
    { now: () => now },
  );

  try {
    const { error } = await supabase
      .schema('app')
      .from('suggestion')
      .update({ status: 'executed' })
      .eq('id', suggestion.id)
      .eq('status', 'approved');
    if (error) {
      actionLog.warn('execute-handler: suggestion status update to executed failed (non-fatal)', {
        error: error.message,
      });
    }
  } catch (err) {
    actionLog.warn('execute-handler: suggestion status update threw (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  actionLog.info('execute-handler: action succeeded');
}

// ---------------------------------------------------------------------------

async function loadAction(supabase: ServiceSupabaseClient, id: string): Promise<ActionRow | null> {
  const { data, error } = await supabase
    .schema('app')
    .from('action')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`app.action lookup failed: ${error.message}`);
  return (data as ActionRow | null) ?? null;
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
  if (error) throw new Error(`app.suggestion lookup failed: ${error.message}`);
  return (data as SuggestionRow | null) ?? null;
}

interface ErrorClassification {
  terminal: boolean;
  reason: string;
  code: string;
  retryDelaySec?: number;
}

export function classifyError(err: unknown): ErrorClassification {
  if (err instanceof UnknownActionKindError) {
    return { terminal: true, reason: err.message, code: err.code };
  }
  if (err instanceof TamperDetectedError) {
    return { terminal: true, reason: err.message, code: err.code };
  }
  if (err instanceof OrphanActionError) {
    return { terminal: true, reason: err.message, code: err.code };
  }
  if (err instanceof ApprovalError) {
    if (err.code === 'NOT_FOUND' || err.code === 'ALREADY_FINALIZED') {
      return { terminal: true, reason: err.message, code: err.code };
    }
    return { terminal: false, reason: err.message, code: err.code, retryDelaySec: 60 };
  }
  const reason = err instanceof Error ? err.message : String(err);
  return { terminal: false, reason, code: 'UNKNOWN', retryDelaySec: 60 };
}

// Wire-type sanity export so tests + downstream code can import the
// action/suggestion update types if they need them.
export type ActionUpdate = Database['app']['Tables']['action']['Update'];
