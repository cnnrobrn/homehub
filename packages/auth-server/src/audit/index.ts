/**
 * Audit-log writer.
 *
 * Every mutation in the household lifecycle appends one row to
 * `audit.event`. Reads/writes on that table are service-role only (by
 * RLS design) — authenticated JWT callers cannot see or write it.
 *
 * Invariants:
 *   - `action` is a stable dotted string (`household.create`,
 *     `household.invite`, etc.). Callers use the constants below.
 *   - `before` / `after` are JSON-compatible snapshots. For `create`
 *     actions `before` is null; for `delete` actions `after` is null.
 *   - A failing audit write does NOT fail the business operation. Audit
 *     lag is preferable to a lost invitation / membership. We log at
 *     `warn` so operators can backfill if needed.
 */

import { type Database, type Json } from '@homehub/db';
import { type SupabaseClient } from '@supabase/supabase-js';

export const AuditAction = {
  HouseholdCreate: 'household.create',
  HouseholdUpdate: 'household.update',
  HouseholdInvite: 'household.invite',
  HouseholdAcceptInvite: 'household.invite.accept',
  HouseholdRevokeMember: 'household.member.revoke',
  HouseholdTransferOwnership: 'household.ownership.transfer',
} as const;

export type AuditActionType = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditWriteInput {
  household_id: string | null;
  actor_user_id: string | null;
  action: AuditActionType | string;
  resource_type: string;
  resource_id: string | null;
  before?: Json | null;
  after?: Json | null;
}

export async function writeAuditEvent(
  service: SupabaseClient<Database>,
  input: AuditWriteInput,
  onError?: (err: unknown) => void,
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
      onError?.(error);
    }
  } catch (err) {
    onError?.(err);
  }
}
