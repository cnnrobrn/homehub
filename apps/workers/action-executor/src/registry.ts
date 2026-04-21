/**
 * Kind-keyed executor registry for the action-executor worker.
 *
 * An executor takes an `{ action, suggestion, supabase, log }` tuple
 * and returns `{ result }`. It is responsible for the provider call
 * itself (the `@integrations` lane in M9-B) — status transitions and
 * audit writes happen in the worker shell around it via
 * `@homehub/approval-flow`.
 *
 * M9-A ships with an EMPTY registry. Registering executors is M9-B's
 * job. When the worker pulls a message with a kind that has no
 * registered executor it throws `UnknownActionKindError` — the caller
 * (the `execute-handler`) catches this, marks the action `failed` with
 * an explanatory error, and dead-letters the message. This keeps the
 * worker safe to run in prod even before the provider layer lands:
 * nothing executes by accident.
 *
 * Registration API:
 *
 *   import { registerExecutor } from '@homehub/worker-action-executor/src/registry';
 *
 *   registerExecutor('outing_idea', async ({ action, suggestion, supabase }) => {
 *     // provider call here
 *     return { result: { external_id: '...' } };
 *   });
 *
 * M9-B will call this from its own bootstrap module during the worker's
 * `main()` setup so the registry is populated before the claim loop
 * starts.
 */

import { type ActionRow, type SuggestionRow } from '@homehub/approval-flow';
import { type Logger, type ServiceSupabaseClient } from '@homehub/worker-runtime';

export interface ExecutorArgs {
  action: ActionRow;
  suggestion: SuggestionRow;
  supabase: ServiceSupabaseClient;
  log: Logger;
}

export interface ExecutorSuccess {
  result: unknown;
}

export type ActionExecutor = (args: ExecutorArgs) => Promise<ExecutorSuccess>;

/**
 * Raised when a message's kind has no registered executor. The handler
 * catches this, marks the action failed, and DLQs the message.
 */
export class UnknownActionKindError extends Error {
  readonly code = 'UNKNOWN_ACTION_KIND';
  readonly kind: string;
  constructor(kind: string) {
    super(`no executor registered for kind "${kind}"`);
    this.name = 'UnknownActionKindError';
    this.kind = kind;
  }
}

/**
 * Raised by the handler when the suggestion_hash stored in the action
 * payload doesn't match the current hash of the referenced suggestion.
 * A fresh build always marks the message as tampered → DLQ; we never
 * retry tamper-detected actions.
 */
export class TamperDetectedError extends Error {
  readonly code = 'TAMPER_DETECTED';
  constructor(message: string) {
    super(message);
    this.name = 'TamperDetectedError';
  }
}

/**
 * Raised when the action row carries no linked suggestion_id. The
 * current contract requires suggestion-rooted actions (preview is the
 * single source of truth for "what is this"). Unlinked actions are a
 * programmer bug — DLQ.
 */
export class OrphanActionError extends Error {
  readonly code = 'ORPHAN_ACTION';
  constructor(actionId: string) {
    super(`action ${actionId} has no suggestion_id; unsupported in M9`);
    this.name = 'OrphanActionError';
  }
}

/**
 * The registry. Exposed as a mutable Map so integration packages can
 * call `registerExecutor`; we do NOT freeze it because late binding is
 * the whole point.
 */
export const executorRegistry: Map<string, ActionExecutor> = new Map();

export function registerExecutor(kind: string, handler: ActionExecutor): void {
  if (executorRegistry.has(kind)) {
    throw new Error(`executor for kind "${kind}" already registered`);
  }
  executorRegistry.set(kind, handler);
}

export function getExecutor(kind: string): ActionExecutor {
  const h = executorRegistry.get(kind);
  if (!h) throw new UnknownActionKindError(kind);
  return h;
}

/**
 * Test-only helper: clear the registry between tests. Not exported via
 * the package's default surface; importers who need it should pull from
 * `./registry.js` directly.
 */
export function __clearRegistryForTests(): void {
  executorRegistry.clear();
}
