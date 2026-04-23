/**
 * Server actions for household lifecycle.
 *
 * Each function is a thin wrapper over `@homehub/auth-server`:
 *   1. Read the current user from the session cookie.
 *   2. Zod-parse the raw FormData / typed input.
 *   3. Call the corresponding auth-server flow under the service-role
 *      client (the flows enforce authorization in application code and
 *      the RLS policies in the database act as the backstop).
 *   4. Wrap the return value in an `ActionResult<T>` envelope.
 *
 * All logic-of-consequence lives in `@homehub/auth-server`; these
 * actions are the Next.js entry points and the place where we convert
 * thrown errors into `{ ok: false, error }`.
 */

'use server';

import {
  type AcceptInvitationResult,
  type CreateHouseholdResult,
  type InviteMemberResult,
  type ListHouseholdsResult,
  type PreviewInvitationResult,
  type UpdateHouseholdResult,
  UnauthorizedError,
  acceptInvitation as baseAcceptInvitation,
  createHousehold as baseCreateHousehold,
  createServiceClient,
  getUser,
  inviteMember as baseInviteMember,
  listHouseholds as baseListHouseholds,
  previewInvitation as basePreviewInvitation,
  updateHousehold as baseUpdateHousehold,
} from '@homehub/auth-server';
import { type Json } from '@homehub/db';
import { z } from 'zod';

import { type ActionResult, ok, toErr } from './_envelope';

import { nextCookieAdapter } from '@/lib/auth/cookies';
import { authEnv } from '@/lib/auth/env';

const segmentSchema = z.enum(['financial', 'food', 'fun', 'social', 'system']);
const setupSegmentSchema = z.enum(['financial', 'food', 'fun', 'social']);
const accessSchema = z.enum(['none', 'read', 'write']);
const roleSchema = z.enum(['owner', 'adult', 'child', 'guest']);

const createHouseholdFormSchema = z.object({
  name: z.string().min(1).max(200),
  timezone: z.string().min(1).max(64).optional(),
  currency: z.string().length(3).optional(),
  weekStart: z.enum(['sunday', 'monday']).optional(),
  setupSegments: z.array(setupSegmentSchema).max(4).optional(),
  setupPromptIds: z.array(z.string().min(1).max(80)).max(24).optional(),
  setupPrompt: z.string().max(4000).optional(),
});

export async function createHouseholdAction(
  input: z.input<typeof createHouseholdFormSchema>,
): Promise<ActionResult<CreateHouseholdResult>> {
  try {
    const env = authEnv();
    const cookies = await nextCookieAdapter();
    const user = await getUser(env, cookies);
    if (!user) throw new UnauthorizedError('no session');

    const parsed = createHouseholdFormSchema.parse(input);
    const service = createServiceClient(env);

    const result = await baseCreateHousehold(
      service,
      env,
      { userId: user.id, ...parsed },
      { email: user.email, displayName: null },
    );

    const hasSetup =
      parsed.setupSegments !== undefined ||
      parsed.setupPromptIds !== undefined ||
      parsed.setupPrompt !== undefined;
    if (hasSetup) {
      const currentSettings =
        result.household.settings &&
        typeof result.household.settings === 'object' &&
        !Array.isArray(result.household.settings)
          ? (result.household.settings as Record<string, Json>)
          : {};
      const currentOnboarding =
        currentSettings.onboarding &&
        typeof currentSettings.onboarding === 'object' &&
        !Array.isArray(currentSettings.onboarding)
          ? (currentSettings.onboarding as Record<string, Json>)
          : {};
      const setupSegments = [...new Set(parsed.setupSegments ?? [])];
      const setupPromptIds = [...new Set(parsed.setupPromptIds ?? [])];
      const setupAt = new Date().toISOString();
      const hasPreselectedSetup = setupSegments.length > 0 || setupPromptIds.length > 0;
      const settings: Record<string, Json> = {
        ...currentSettings,
        onboarding: {
          ...currentOnboarding,
          setup_segments: setupSegments,
          setup_prompt_ids: setupPromptIds,
          ...(parsed.setupPrompt ? { alfred_setup_prompt: parsed.setupPrompt } : {}),
          ...(currentOnboarding.started_at ? {} : { started_at: setupAt }),
          ...(hasPreselectedSetup ? { completed_at: setupAt } : {}),
        } as Json,
      };
      const { data: updatedHousehold, error: updateErr } = await service
        .schema('app')
        .from('household')
        .update({ settings: settings as Json })
        .eq('id', result.household.id)
        .select('id, name, settings, created_at')
        .single();
      if (updateErr) {
        throw new Error(`onboarding setup update failed: ${updateErr.message}`);
      }
      if (updatedHousehold) {
        result.household = updatedHousehold;
      }
    }

    // Tell hermes-router to allocate a GCS state prefix for this
    // household. Cheap operation (a row update), but worth doing at
    // create time so the first chat turn doesn't have to also bootstrap
    // the pointer. Best-effort — the router self-heals on first chat
    // turn if this fails. HOMEHUB_HERMES_ROUTER_SECRET here is the
    // *provisioning* secret (not the proxy secret); they are distinct.
    if (process.env.HOMEHUB_USE_HERMES_ROUTER === '1') {
      const routerUrl = process.env.HOMEHUB_HERMES_ROUTER_URL;
      const provisionSecret = process.env.HOMEHUB_HERMES_PROVISION_SECRET;
      if (routerUrl && provisionSecret) {
        void fetch(`${routerUrl.replace(/\/$/, '')}/provision/${result.household.id}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${provisionSecret}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }).catch((err) => {
          console.warn('[createHouseholdAction] hermes pre-provision failed', {
            householdId: result.household.id,
            message: err instanceof Error ? err.message : String(err),
          });
        });
      }
    }

    return ok(result);
  } catch (err) {
    return toErr(err);
  }
}

const inviteMemberFormSchema = z.object({
  householdId: z.string().uuid(),
  email: z.string().email(),
  role: roleSchema,
  grants: z.array(z.object({ segment: segmentSchema, access: accessSchema })).default([]),
});

export async function inviteMemberAction(
  input: z.input<typeof inviteMemberFormSchema>,
): Promise<ActionResult<InviteMemberResult>> {
  try {
    const env = authEnv();
    const cookies = await nextCookieAdapter();
    const user = await getUser(env, cookies);
    if (!user) throw new UnauthorizedError('no session');

    const parsed = inviteMemberFormSchema.parse(input);
    const service = createServiceClient(env);

    // Resolve the user's member-id in the target household.
    const { resolveMemberId } = await import('@homehub/auth-server');
    const memberId = await resolveMemberId(service, parsed.householdId, user.id);
    if (!memberId) throw new UnauthorizedError('not a member of this household');

    const result = await baseInviteMember(service, env, {
      householdId: parsed.householdId,
      inviterMemberId: memberId,
      email: parsed.email,
      role: parsed.role,
      grants: parsed.grants,
    });
    return ok(result);
  } catch (err) {
    return toErr(err);
  }
}

const acceptInvitationFormSchema = z.object({
  token: z.string().min(1),
});

export async function acceptInvitationAction(
  input: z.input<typeof acceptInvitationFormSchema>,
): Promise<ActionResult<AcceptInvitationResult>> {
  try {
    const env = authEnv();
    const cookies = await nextCookieAdapter();
    const user = await getUser(env, cookies);
    if (!user) throw new UnauthorizedError('no session');

    const parsed = acceptInvitationFormSchema.parse(input);
    const service = createServiceClient(env);
    const result = await baseAcceptInvitation(
      service,
      env,
      { token: parsed.token, userId: user.id },
      { email: user.email },
    );
    return ok(result);
  } catch (err) {
    return toErr(err);
  }
}

export async function listHouseholdsAction(): Promise<ActionResult<ListHouseholdsResult[]>> {
  try {
    const env = authEnv();
    const cookies = await nextCookieAdapter();
    const user = await getUser(env, cookies);
    if (!user) throw new UnauthorizedError('no session');

    const service = createServiceClient(env);
    const result = await baseListHouseholds(service, env, { userId: user.id });
    return ok(result);
  } catch (err) {
    return toErr(err);
  }
}

const previewInvitationFormSchema = z.object({
  token: z.string().min(1),
});

/**
 * Read-only invitation preview. Intentionally NOT gated by a session:
 * the `(public)/invite/[token]` page renders "you're invited to X as Y"
 * before the invitee signs in. The hashed-token lookup is the entire
 * authorization model — guessing an unhashed token buys you nothing.
 */
export async function previewInvitationAction(
  input: z.input<typeof previewInvitationFormSchema>,
): Promise<ActionResult<PreviewInvitationResult | null>> {
  try {
    const env = authEnv();
    const parsed = previewInvitationFormSchema.parse(input);
    const service = createServiceClient(env);
    const result = await basePreviewInvitation(service, env, parsed);
    return ok(result);
  } catch (err) {
    return toErr(err);
  }
}

const updateHouseholdFormSchema = z.object({
  householdId: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  timezone: z.string().min(1).max(64).optional(),
  currency: z.string().length(3).optional(),
  weekStart: z.enum(['sunday', 'monday']).optional(),
});

export async function updateHouseholdAction(
  input: z.input<typeof updateHouseholdFormSchema>,
): Promise<ActionResult<UpdateHouseholdResult>> {
  try {
    const env = authEnv();
    const cookies = await nextCookieAdapter();
    const user = await getUser(env, cookies);
    if (!user) throw new UnauthorizedError('no session');

    const parsed = updateHouseholdFormSchema.parse(input);
    const service = createServiceClient(env);

    const { resolveMemberId } = await import('@homehub/auth-server');
    const memberId = await resolveMemberId(service, parsed.householdId, user.id);
    if (!memberId) throw new UnauthorizedError('not a member of this household');

    const result = await baseUpdateHousehold(service, env, {
      householdId: parsed.householdId,
      actorMemberId: memberId,
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
      ...(parsed.timezone !== undefined ? { timezone: parsed.timezone } : {}),
      ...(parsed.currency !== undefined ? { currency: parsed.currency } : {}),
      ...(parsed.weekStart !== undefined ? { weekStart: parsed.weekStart } : {}),
    });
    return ok(result);
  } catch (err) {
    return toErr(err);
  }
}
