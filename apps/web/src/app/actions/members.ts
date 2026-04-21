/**
 * Server actions for member management within a household.
 *
 * All actions re-resolve the caller's member id from their session +
 * the target household before calling the auth-server flows. Mutations
 * are owner-only (revoke, transfer); list is visible to any member.
 */

'use server';

import {
  type ListInvitationsResult,
  type ListMembersResult,
  UnauthorizedError,
  createServiceClient,
  getUser,
  listInvitations as baseListInvitations,
  listMembers as baseListMembers,
  resolveMemberId,
  revokeMember as baseRevokeMember,
  transferOwnership as baseTransferOwnership,
} from '@homehub/auth-server';
import { z } from 'zod';

import { type ActionResult, ok, toErr } from './_envelope';

import { nextCookieAdapter } from '@/lib/auth/cookies';
import { authEnv } from '@/lib/auth/env';

const listMembersFormSchema = z.object({
  householdId: z.string().uuid(),
});

export async function listMembersAction(
  input: z.input<typeof listMembersFormSchema>,
): Promise<ActionResult<ListMembersResult[]>> {
  try {
    const env = authEnv();
    const cookies = await nextCookieAdapter();
    const user = await getUser(env, cookies);
    if (!user) throw new UnauthorizedError('no session');

    const parsed = listMembersFormSchema.parse(input);
    const service = createServiceClient(env);
    const memberId = await resolveMemberId(service, parsed.householdId, user.id);
    if (!memberId) throw new UnauthorizedError('not a member of this household');

    const result = await baseListMembers(service, env, {
      householdId: parsed.householdId,
      requestorMemberId: memberId,
    });
    return ok(result);
  } catch (err) {
    return toErr(err);
  }
}

const revokeMemberFormSchema = z.object({
  householdId: z.string().uuid(),
  targetMemberId: z.string().uuid(),
});

export async function revokeMemberAction(
  input: z.input<typeof revokeMemberFormSchema>,
): Promise<ActionResult<{ ok: true }>> {
  try {
    const env = authEnv();
    const cookies = await nextCookieAdapter();
    const user = await getUser(env, cookies);
    if (!user) throw new UnauthorizedError('no session');

    const parsed = revokeMemberFormSchema.parse(input);
    const service = createServiceClient(env);
    const actorMemberId = await resolveMemberId(service, parsed.householdId, user.id);
    if (!actorMemberId) throw new UnauthorizedError('not a member of this household');

    const result = await baseRevokeMember(service, env, {
      householdId: parsed.householdId,
      actorMemberId,
      targetMemberId: parsed.targetMemberId,
    });
    return ok(result);
  } catch (err) {
    return toErr(err);
  }
}

const listInvitationsFormSchema = z.object({
  householdId: z.string().uuid(),
});

export async function listInvitationsAction(
  input: z.input<typeof listInvitationsFormSchema>,
): Promise<ActionResult<ListInvitationsResult[]>> {
  try {
    const env = authEnv();
    const cookies = await nextCookieAdapter();
    const user = await getUser(env, cookies);
    if (!user) throw new UnauthorizedError('no session');

    const parsed = listInvitationsFormSchema.parse(input);
    const service = createServiceClient(env);
    const memberId = await resolveMemberId(service, parsed.householdId, user.id);
    if (!memberId) throw new UnauthorizedError('not a member of this household');

    const result = await baseListInvitations(service, env, {
      householdId: parsed.householdId,
      requestorMemberId: memberId,
    });
    return ok(result);
  } catch (err) {
    return toErr(err);
  }
}

const transferOwnershipFormSchema = z.object({
  householdId: z.string().uuid(),
  newOwnerMemberId: z.string().uuid(),
});

export async function transferOwnershipAction(
  input: z.input<typeof transferOwnershipFormSchema>,
): Promise<ActionResult<{ ok: true }>> {
  try {
    const env = authEnv();
    const cookies = await nextCookieAdapter();
    const user = await getUser(env, cookies);
    if (!user) throw new UnauthorizedError('no session');

    const parsed = transferOwnershipFormSchema.parse(input);
    const service = createServiceClient(env);
    const currentOwnerMemberId = await resolveMemberId(service, parsed.householdId, user.id);
    if (!currentOwnerMemberId) throw new UnauthorizedError('not a member of this household');

    const result = await baseTransferOwnership(service, env, {
      householdId: parsed.householdId,
      currentOwnerMemberId,
      newOwnerMemberId: parsed.newOwnerMemberId,
    });
    return ok(result);
  } catch (err) {
    return toErr(err);
  }
}
