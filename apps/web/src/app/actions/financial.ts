/**
 * Server actions for the Financial segment UI.
 *
 * - `dismissAlertAction` — sets `app.alert.dismissed_at = now()` and
 *   `dismissed_by = <memberId>`. RLS permits member writes on alerts in
 *   their own household; we use the authed SSR client first and fall
 *   back to the service-role client if RLS blocks (M5-B bootstrapped
 *   the policy but the follow-up list flagged a re-check — if the
 *   member-write policy lands after this ships, the service-role fallback
 *   is still audit-written so nothing slips through unlogged).
 * - `proposeCancelSubscriptionAction` — inserts a pending
 *   `app.suggestion` row of kind `cancel_subscription`. Actual
 *   execution lands in M9's approval flow.
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
// dismissAlertAction
// ==========================================================================

const dismissAlertSchema = z.object({
  alertId: z.string().uuid(),
  reason: z.string().max(2_000).optional(),
});

interface AlertShape {
  id: string;
  household_id: string;
  segment: string;
  dismissed_at: string | null;
}

/**
 * Dismiss an active alert. Writes `dismissed_at = now()` and
 * `dismissed_by = <memberId>` on the row.
 *
 * Uses the service-role client so the write is not blocked by RLS
 * nuances around alert updates; we gate on explicit household
 * membership before the write. The audit event carries the prior
 * `dismissed_at` value so rollbacks are explicit.
 */
export async function dismissAlertAction(
  input: z.input<typeof dismissAlertSchema>,
): Promise<ActionResult<{ alertId: string; dismissedAt: string }>> {
  try {
    const parsed = dismissAlertSchema.parse(input);
    const env = authEnv();
    const service = createServiceClient(env);

    const { data: alertRow, error: loadErr } = await service
      .schema('app')
      .from('alert')
      .select('id, household_id, segment, dismissed_at')
      .eq('id', parsed.alertId)
      .maybeSingle();
    if (loadErr) throw new Error(`dismissAlertAction: ${loadErr.message}`);
    if (!alertRow) {
      throw new ValidationError('alert not found', [
        { path: 'alertId', message: 'alert not found' },
      ]);
    }
    const alert = alertRow as AlertShape;
    const actor = await requireMemberForHousehold(alert.household_id);

    if (alert.dismissed_at !== null) {
      return ok({ alertId: alert.id, dismissedAt: alert.dismissed_at });
    }

    const dismissedAt = new Date().toISOString();
    const { error: updErr } = await actor.service
      .schema('app')
      .from('alert')
      .update({ dismissed_at: dismissedAt, dismissed_by: actor.memberId })
      .eq('id', alert.id);
    if (updErr) throw new Error(`dismissAlertAction: ${updErr.message}`);

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'app.alert.dismissed',
      resource_type: 'app.alert',
      resource_id: alert.id,
      before: { dismissed_at: null },
      after: {
        dismissed_at: dismissedAt,
        dismissed_by: actor.memberId,
        reason: parsed.reason ?? null,
        segment: alert.segment,
      },
    });

    return ok({ alertId: alert.id, dismissedAt });
  } catch (err) {
    return toErr(err);
  }
}

// ==========================================================================
// proposeCancelSubscriptionAction
// ==========================================================================

const proposeCancelSchema = z.object({
  subscriptionNodeId: z.string().uuid(),
  rationale: z.string().max(2_000).optional(),
});

interface SubscriptionNodeShape {
  id: string;
  household_id: string;
  type: string;
  canonical_name: string;
}

/**
 * Stub for M9: inserts a pending `app.suggestion` row of kind
 * `cancel_subscription`. The full approval-flow wiring (Approve →
 * execute → revoke) lives in M9; for M5-C we only record the member's
 * intent so the dashboard can surface it in the pending queue.
 */
export async function proposeCancelSubscriptionAction(
  input: z.input<typeof proposeCancelSchema>,
): Promise<ActionResult<{ suggestionId: string }>> {
  try {
    const parsed = proposeCancelSchema.parse(input);
    const env = authEnv();
    const service = createServiceClient(env);

    const { data: nodeRow, error: loadErr } = await service
      .schema('mem')
      .from('node')
      .select('id, household_id, type, canonical_name')
      .eq('id', parsed.subscriptionNodeId)
      .maybeSingle();
    if (loadErr) throw new Error(`proposeCancelSubscriptionAction: ${loadErr.message}`);
    if (!nodeRow) {
      throw new ValidationError('subscription not found', [
        { path: 'subscriptionNodeId', message: 'node not found' },
      ]);
    }
    const node = nodeRow as SubscriptionNodeShape;
    if (node.type !== 'subscription') {
      throw new ValidationError('node is not a subscription', [
        { path: 'subscriptionNodeId', message: 'expected type=subscription' },
      ]);
    }
    const actor = await requireMemberForHousehold(node.household_id);

    const { data: inserted, error: insertErr } = await actor.service
      .schema('app')
      .from('suggestion')
      .insert({
        household_id: actor.householdId,
        segment: 'financial',
        kind: 'cancel_subscription',
        status: 'pending',
        title: `Cancel ${node.canonical_name}`,
        rationale:
          parsed.rationale ??
          `Member proposed cancelling recurring charges for ${node.canonical_name}.`,
        preview: {
          subscription_node_id: node.id,
          canonical_name: node.canonical_name,
          proposed_by_member_id: actor.memberId,
        },
      })
      .select('id')
      .single();
    if (insertErr) throw new Error(`proposeCancelSubscriptionAction: ${insertErr.message}`);

    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'app.suggestion.proposed',
      resource_type: 'app.suggestion',
      resource_id: inserted.id,
      after: {
        kind: 'cancel_subscription',
        subscription_node_id: node.id,
      },
    });

    return ok({ suggestionId: inserted.id as string });
  } catch (err) {
    return toErr(err);
  }
}
