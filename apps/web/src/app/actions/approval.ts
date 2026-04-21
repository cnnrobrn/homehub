/**
 * Server actions for the auto-approval settings page.
 *
 * - `updateAutoApprovalKindsAction` — owner-only. Merges the supplied
 *   `kinds` list into `household.settings.approval.auto_approve_kinds`.
 *   The approval-flow `AUTO_APPROVAL_DENY_LIST` is applied on the UI
 *   side (kinds in the deny list are never offered as options) and on
 *   the state-machine side (the policy evaluator refuses to
 *   auto-approve deny-listed kinds even if they slip through). This
 *   action enforces the UI-side filter one more time before writing.
 *
 * - `listAutoApprovalAuditAction` — owner-only. Reads recent
 *   `audit.event` rows with `action like 'suggestion.%' or 'action.%'`
 *   so the settings page can show the last 10 approve / reject /
 *   execute events.
 */

'use server';

import { AUTO_APPROVAL_DENY_LIST } from '@homehub/approval-flow';
import {
  UnauthorizedError,
  ValidationError,
  createServiceClient,
  getUser,
  writeAuditEvent,
} from '@homehub/auth-server';
import { type Json } from '@homehub/db';
import { z } from 'zod';

import { type ActionResult, ok, toErr } from './_envelope';

import { AUTO_APPROVE_KIND_OPTIONS } from '@/lib/approval/kinds';
import { requireHouseholdContext } from '@/lib/auth/context';
import { authEnv } from '@/lib/auth/env';

const updateAutoApprovalSchema = z.object({
  kinds: z.array(z.string()).max(50),
});

export async function updateAutoApprovalKindsAction(
  input: z.input<typeof updateAutoApprovalSchema>,
): Promise<ActionResult<{ kinds: string[] }>> {
  try {
    const parsed = updateAutoApprovalSchema.parse(input);

    const ctx = await requireHouseholdContext();
    if (ctx.member.role !== 'owner') {
      throw new UnauthorizedError('only owners can change auto-approval kinds');
    }

    // Filter out any kind that would conflict with the deny list or
    // isn't a recognized option. This is belt-and-suspenders over the
    // policy evaluator's own check.
    const allowedOptions = new Set<string>(AUTO_APPROVE_KIND_OPTIONS);
    const nextKinds = Array.from(
      new Set(parsed.kinds.filter((k) => allowedOptions.has(k) && !AUTO_APPROVAL_DENY_LIST.has(k))),
    );

    const env = authEnv();
    const service = createServiceClient(env);

    const user = await getUser(env, await (await import('@/lib/auth/cookies')).nextCookieAdapter());
    if (!user) throw new UnauthorizedError('no session');

    const { data: row, error: loadErr } = await service
      .schema('app')
      .from('household')
      .select('id, settings')
      .eq('id', ctx.household.id)
      .maybeSingle();
    if (loadErr) throw new Error(`updateAutoApprovalKinds load: ${loadErr.message}`);
    if (!row) throw new ValidationError('household not found', []);

    const existingSettings =
      row.settings && typeof row.settings === 'object' && !Array.isArray(row.settings)
        ? { ...(row.settings as Record<string, Json>) }
        : {};
    const existingApproval =
      existingSettings['approval'] &&
      typeof existingSettings['approval'] === 'object' &&
      !Array.isArray(existingSettings['approval'])
        ? { ...(existingSettings['approval'] as Record<string, Json>) }
        : {};

    const nextSettings: Record<string, Json> = {
      ...existingSettings,
      approval: {
        ...existingApproval,
        auto_approve_kinds: nextKinds as unknown as Json,
      } as Json,
    };

    const { error: updateErr } = await service
      .schema('app')
      .from('household')
      .update({ settings: nextSettings as Json })
      .eq('id', ctx.household.id);
    if (updateErr) throw new Error(`updateAutoApprovalKinds update: ${updateErr.message}`);

    await writeAuditEvent(service, {
      household_id: ctx.household.id,
      actor_user_id: user.id,
      action: 'household.approval.kinds_updated',
      resource_type: 'household',
      resource_id: ctx.household.id,
      before: { auto_approve_kinds: existingApproval['auto_approve_kinds'] ?? [] } as Json,
      after: { auto_approve_kinds: nextKinds } as Json,
    });

    return ok({ kinds: nextKinds });
  } catch (err) {
    return toErr(err);
  }
}

const listAuditSchema = z.object({
  limit: z.number().int().positive().max(50).optional(),
});

export interface ApprovalAuditEntry {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  at: string;
  actorUserId: string | null;
}

export async function listAutoApprovalAuditAction(
  input?: z.input<typeof listAuditSchema>,
): Promise<ActionResult<{ entries: ApprovalAuditEntry[] }>> {
  try {
    const parsed = listAuditSchema.parse(input ?? {});
    const ctx = await requireHouseholdContext();
    if (ctx.member.role !== 'owner') {
      throw new UnauthorizedError('only owners can view approval audit log');
    }

    const env = authEnv();
    const service = createServiceClient(env);

    const { data, error } = await service
      .schema('audit')
      .from('event')
      .select('id, action, resource_type, resource_id, at, actor_user_id')
      .eq('household_id', ctx.household.id)
      .or('action.like.suggestion.%,action.like.action.%')
      .order('at', { ascending: false })
      .limit(parsed.limit ?? 10);
    if (error) throw new Error(`listAutoApprovalAudit: ${error.message}`);

    const entries: ApprovalAuditEntry[] = (
      (data ?? []) as Array<{
        id: string;
        action: string;
        resource_type: string;
        resource_id: string | null;
        at: string;
        actor_user_id: string | null;
      }>
    ).map((r) => ({
      id: r.id,
      action: r.action,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      at: r.at,
      actorUserId: r.actor_user_id,
    }));

    return ok({ entries });
  } catch (err) {
    return toErr(err);
  }
}
