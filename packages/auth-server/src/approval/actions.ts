/**
 * Server-action helpers for the approval flow.
 *
 * These wrap `@homehub/approval-flow` primitives with the
 * `getHouseholdContext` + service-role + audit plumbing that the
 * web app's Server Actions expect. They centralize three things the
 * UI-facing callers would otherwise reimplement:
 *
 *   - Resolving the current member for a given household from the
 *     session cookie. The approval path needs the actor's member id
 *     (so we can record them on the suggestion's approvers list) and
 *     the user id (for the `audit.event.actor_user_id` column).
 *   - Loading household settings so `getPolicyFor` can pick up
 *     `auto_approve_kinds` overrides. The helpers still honor the
 *     hard deny list — destructive kinds can't be auto-approved even
 *     if enabled.
 *   - Constructing the service-role client once per invocation and
 *     passing it into the state machine. All DB mutations route
 *     through service-role because the state-machine relies on a
 *     client that can both write `audit.event` (RLS-restricted) and
 *     the suggestion/action tables (RLS-restricted to service_role
 *     for writes).
 *
 * The UI shouldn't call these helpers directly from client components.
 * They are intended for use from Next.js Server Actions in
 * `apps/web/src/app/actions/`.
 */

import {
  approveSuggestion as coreApproveSuggestion,
  getApprovalState as coreGetApprovalState,
  rejectSuggestion as coreRejectSuggestion,
  type ApprovalSettings,
  type ApprovalState,
} from '@homehub/approval-flow';
import { type Database } from '@homehub/db';
import { type SupabaseClient } from '@supabase/supabase-js';

import { type CookieAdapter, createServiceClient } from '../clients/index.js';
import { getHouseholdContext } from '../context/household.js';
import { type AuthServerEnv } from '../env.js';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../errors/index.js';

export interface ApprovalActionArgs {
  env: Pick<AuthServerEnv, 'SUPABASE_URL' | 'SUPABASE_ANON_KEY' | 'SUPABASE_SERVICE_ROLE_KEY'>;
  cookies: CookieAdapter;
  suggestionId: string;
  /**
   * Test-only: inject a pre-built service-role client. When omitted (the
   * production path), this helper builds one from `env`. Exposed so
   * unit tests can use the household flows' in-memory fake without
   * monkey-patching `createClient`.
   * @internal
   */
  __serviceClient?: SupabaseClient<Database>;
  /**
   * Test-only: inject a pre-resolved household context. When omitted,
   * the helper calls `getHouseholdContext(env, cookies, ...)` itself.
   * @internal
   */
  __householdContext?: {
    member: { id: string };
    household: { id: string; settings: unknown };
    grants: Array<{ segment: string; access: string }>;
    userId: string;
  };
}

export interface RejectSuggestionActionArgs extends ApprovalActionArgs {
  reason?: string;
}

type ServiceClient = SupabaseClient<Database>;

/**
 * Internal helper: resolve the actor's household context for a given
 * suggestion. Fails with:
 *
 *   - `UnauthorizedError` when there is no session.
 *   - `NotFoundError` when the suggestion does not exist.
 *   - `ForbiddenError` when the caller is not a member of the
 *     suggestion's household OR when the caller lacks write access to
 *     the suggestion's segment.
 */
async function resolveActor(args: ApprovalActionArgs): Promise<{
  service: ServiceClient;
  userId: string;
  memberId: string;
  householdId: string;
  suggestion: { segment: string };
  settings: ApprovalSettings;
}> {
  const service = args.__serviceClient ?? createServiceClient(args.env);

  // Load the suggestion so we know which household to resolve context for.
  const { data: suggestion, error } = await service
    .schema('app')
    .from('suggestion')
    .select('id, household_id, segment')
    .eq('id', args.suggestionId)
    .maybeSingle();
  if (error) {
    throw new NotFoundError(`suggestion lookup failed: ${error.message}`);
  }
  if (!suggestion) {
    throw new NotFoundError(`suggestion ${args.suggestionId} not found`);
  }

  let ctx: {
    member: { id: string };
    household: { id: string; settings: unknown };
    grants: Array<{ segment: string; access: string }>;
  } | null;
  let injectedUserId: string | null = null;
  if (args.__householdContext) {
    ctx = args.__householdContext;
    injectedUserId = args.__householdContext.userId;
  } else {
    ctx = await getHouseholdContext(args.env, args.cookies, {
      householdId: suggestion.household_id as string,
    });
  }
  if (!ctx) {
    // Either no session or not a member. Discriminate by re-checking
    // the user — we call getHouseholdContext twice defensively because
    // the first call's null could be unauthenticated OR forbidden.
    const ctxWithoutHousehold = await getHouseholdContext(args.env, args.cookies, {});
    if (!ctxWithoutHousehold) {
      throw new UnauthorizedError('no session');
    }
    throw new ForbiddenError(`not a member of household ${suggestion.household_id as string}`);
  }

  // Segment-write check. The suggestion's segment determines which grants
  // the actor needs to approve/reject. This is belt-and-suspenders over
  // the RLS policy on `app.suggestion_update`.
  const grant = ctx.grants.find((g) => g.segment === (suggestion.segment as string));
  if (!grant || grant.access !== 'write') {
    throw new ForbiddenError(`no write access to segment ${suggestion.segment as string}`);
  }

  let userId: string | null = injectedUserId;
  if (!userId) {
    // Load the caller's user id for audit attribution via the service client.
    const { data: memberRow } = await service
      .schema('app')
      .from('member')
      .select('user_id')
      .eq('id', ctx.member.id)
      .maybeSingle();
    userId = (memberRow as { user_id: string | null } | null)?.user_id ?? null;
  }
  if (!userId) {
    throw new UnauthorizedError('session member has no user id');
  }

  const settings = (ctx.household.settings ?? {}) as ApprovalSettings;

  return {
    service,
    userId,
    memberId: ctx.member.id,
    householdId: ctx.household.id,
    suggestion: { segment: suggestion.segment as string },
    settings,
  };
}

/**
 * Approve a suggestion. Returns the resulting `ApprovalState` (useful
 * for the UI to decide whether to show a "waiting for second approver"
 * affordance when quorum > 1).
 */
export async function approveSuggestionAction(args: ApprovalActionArgs): Promise<ApprovalState> {
  const actor = await resolveActor(args);
  return coreApproveSuggestion(actor.service, {
    suggestionId: args.suggestionId,
    actorMemberId: actor.memberId,
    actorUserId: actor.userId,
    settings: actor.settings,
  });
}

/**
 * Reject a suggestion with an optional reason.
 */
export async function rejectSuggestionAction(args: RejectSuggestionActionArgs): Promise<void> {
  const actor = await resolveActor(args);
  await coreRejectSuggestion(actor.service, {
    suggestionId: args.suggestionId,
    actorMemberId: actor.memberId,
    actorUserId: actor.userId,
    ...(args.reason ? { reason: args.reason } : {}),
  });
}

/**
 * Read-only view of the current approval state. Used by UI to render
 * "already approved by X, waiting on Y" copy when quorum > 1.
 */
export async function getApprovalStateAction(args: ApprovalActionArgs): Promise<ApprovalState> {
  const actor = await resolveActor(args);
  return coreGetApprovalState(actor.service, args.suggestionId, { settings: actor.settings });
}
