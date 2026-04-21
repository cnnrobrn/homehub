/**
 * Audit-writing helpers used by the state machine.
 *
 * Every state transition appends one row to `audit.event`. We do NOT
 * raise when the audit insert fails — audit lag is preferable to
 * losing the business state — but we do log through the provided
 * logger (or console when none) so operators can backfill.
 *
 * Actions use the stable dotted names documented in the brief:
 *
 *   suggestion.approved, suggestion.rejected, suggestion.auto_approved
 *   action.dispatched, action.started, action.succeeded, action.failed
 */

import { type Database, type Json } from '@homehub/db';
import { type SupabaseClient } from '@supabase/supabase-js';

export const AUDIT_ACTIONS = {
  SuggestionApproved: 'suggestion.approved',
  SuggestionAutoApproved: 'suggestion.auto_approved',
  SuggestionRejected: 'suggestion.rejected',
  ActionDispatched: 'action.dispatched',
  ActionStarted: 'action.started',
  ActionSucceeded: 'action.succeeded',
  ActionFailed: 'action.failed',
} as const;

export type ApprovalAuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface ApprovalAuditInput {
  household_id: string;
  actor_user_id: string | null;
  action: ApprovalAuditAction | string;
  resource_type: 'suggestion' | 'action';
  resource_id: string;
  before?: Json | null;
  after?: Json | null;
}

export interface AuditLogger {
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
}

const consoleLogger: AuditLogger = {
  warn: (msg, ctx) => {
    console.warn(`[approval-flow] ${msg}`, ctx ?? {});
  },
};

export async function writeApprovalAudit(
  service: SupabaseClient<Database>,
  input: ApprovalAuditInput,
  logger: AuditLogger = consoleLogger,
): Promise<void> {
  try {
    const { error } = await service
      .schema('audit')
      .from('event')
      .insert({
        household_id: input.household_id,
        actor_user_id: input.actor_user_id,
        action: input.action,
        resource_type: input.resource_type,
        resource_id: input.resource_id,
        before: input.before ?? null,
        after: input.after ?? null,
      });
    if (error) {
      logger.warn('approval-flow audit write failed', {
        action: input.action,
        resource_id: input.resource_id,
        error: error.message,
      });
    }
  } catch (err) {
    logger.warn('approval-flow audit write threw', {
      action: input.action,
      resource_id: input.resource_id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
