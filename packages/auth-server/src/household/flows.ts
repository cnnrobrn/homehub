/**
 * Household lifecycle flows.
 *
 * Each exported function is one operation's worth of work: create,
 * invite, accept, list, revoke, transfer. The server actions in
 * `apps/web/src/app/actions/` call these with already-resolved args.
 *
 * Authorization model:
 *   - `createHousehold` runs for a freshly-signed-in user with no prior
 *     membership. Uses the service-role client for the bootstrap insert
 *     because the member-scoped RLS policy permits the caller to insert
 *     their own owner row, but only if we carry the user's session —
 *     and acceptance flows may run across a session boundary (email
 *     sign-up + callback). Service role sidesteps that and we validate
 *     in application code that `userId` matches the intended actor.
 *   - `inviteMember` runs for an existing member. We re-check role +
 *     social-segment write grant in application code for a cleaner
 *     error message; the RLS policy is the backstop.
 *   - `acceptInvitation` runs for the invitee's fresh session. We
 *     always run service-role because the invitee's session, if any,
 *     is not yet a member — RLS would deny the insert.
 *   - `revokeMember` + `transferOwnership` are owner-only; we check in
 *     application code and RLS enforces it regardless.
 *
 * Audit writes happen after the DB mutation succeeds. A failing audit
 * write logs a warning but does NOT roll back the mutation (see
 * `../audit/index.ts`).
 */

import { type Database, type Json } from '@homehub/db';
import { type HouseholdId, type MemberId, addDays, now as nowClock, toIso } from '@homehub/shared';

import { AuditAction, writeAuditEvent } from '../audit/index.js';
import { type ServiceSupabaseClient } from '../clients/index.js';
import { type AuthServerEnv } from '../env.js';
import {
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  ValidationError,
} from '../errors/index.js';
import { generateInvitationToken, hashInvitationToken } from '../invitation/token.js';

import {
  type AcceptInvitationInput,
  type CreateHouseholdInput,
  type InviteMemberInput,
  type ListHouseholdsInput,
  type ListInvitationsInput,
  type ListMembersInput,
  type PreviewInvitationInput,
  type RevokeMemberInput,
  type TransferOwnershipInput,
  type UpdateHouseholdInput,
  acceptInvitationInputSchema,
  createHouseholdInputSchema,
  inviteMemberInputSchema,
  listHouseholdsInputSchema,
  listInvitationsInputSchema,
  listMembersInputSchema,
  previewInvitationInputSchema,
  revokeMemberInputSchema,
  transferOwnershipInputSchema,
  updateHouseholdInputSchema,
} from './schemas.js';

/**
 * Consumers do not call this directly — the module-level flow functions
 * below construct their own service client or accept one from the
 * caller for test injection. Exported so test harnesses can stub.
 * @internal
 */
export type FlowServiceClient = ServiceSupabaseClient;

type HouseholdRow = Database['app']['Tables']['household']['Row'];
type MemberRow = Database['app']['Tables']['member']['Row'];
type GrantRow = Database['app']['Tables']['member_segment_grant']['Row'];

const DEFAULT_OWNER_GRANTS: Array<{
  segment: 'financial' | 'food' | 'fun' | 'social' | 'system';
  access: 'write';
}> = [
  { segment: 'financial', access: 'write' },
  { segment: 'food', access: 'write' },
  { segment: 'fun', access: 'write' },
  { segment: 'social', access: 'write' },
  { segment: 'system', access: 'write' },
];

function warn(msg: string, extra?: Record<string, unknown>): void {
  // Lightweight structured log. We do not pull pino into auth-server to
  // keep the dependency graph tight — the worker runtime has its own
  // logger and the web app uses Next's console transport.

  console.warn(`[auth-server] ${msg}`, extra ?? {});
}

function zodFail(message: string, err: unknown): ValidationError {
  // zod v4: error.issues
  const issues =
    err &&
    typeof err === 'object' &&
    'issues' in err &&
    Array.isArray((err as { issues: unknown }).issues)
      ? (err as { issues: Array<{ path: Array<string | number>; message: string }> }).issues.map(
          (i) => ({
            path: i.path.join('.'),
            message: i.message,
          }),
        )
      : [];
  return new ValidationError(message, issues, { cause: err });
}

// ---------------------------------------------------------------------------
// createHousehold
// ---------------------------------------------------------------------------

export interface CreateHouseholdResult {
  household: Pick<HouseholdRow, 'id' | 'name' | 'settings' | 'created_at'>;
  member: Pick<MemberRow, 'id' | 'household_id' | 'user_id' | 'display_name' | 'role'>;
  grants: Array<Pick<GrantRow, 'segment' | 'access'>>;
}

export async function createHousehold(
  service: FlowServiceClient,
  env: Pick<AuthServerEnv, never>,
  raw: CreateHouseholdInput,
  /** For audits: the email / display_name of the acting user. Optional. */
  actor?: { email?: string | null; displayName?: string | null },
): Promise<CreateHouseholdResult> {
  void env;
  const parse = createHouseholdInputSchema.safeParse(raw);
  if (!parse.success) {
    throw zodFail('invalid createHousehold input', parse.error);
  }
  const input = parse.data;

  const settings: Record<string, Json> = {};
  if (input.timezone) settings.timezone = input.timezone;
  if (input.currency) settings.currency = input.currency;
  if (input.weekStart) settings.week_start = input.weekStart;

  // 1) household row.
  const { data: hRow, error: hErr } = await service
    .schema('app')
    .from('household')
    .insert({
      name: input.name,
      created_by: input.userId,
      settings: settings as Json,
    })
    .select('id, name, settings, created_at')
    .single();
  if (hErr || !hRow) {
    throw new InternalError(`household insert failed: ${hErr?.message ?? 'no row returned'}`, {
      cause: hErr,
    });
  }

  const displayName = actor?.displayName ?? actor?.email ?? 'Owner';

  // 2) owner member row.
  const { data: mRow, error: mErr } = await service
    .schema('app')
    .from('member')
    .insert({
      household_id: hRow.id,
      user_id: input.userId,
      display_name: displayName,
      role: 'owner',
      joined_at: toIso(nowClock()),
      email: actor?.email ?? null,
    })
    .select('id, household_id, user_id, display_name, role')
    .single();
  if (mErr || !mRow) {
    // Best-effort rollback: delete the household we just created. We
    // don't have a transaction primitive across two insert calls via
    // PostgREST, so a DB-level outage between these two is the worst
    // case — the household is owner-less. A follow-up sweep job in
    // M11 can detect "household with no owner" and clean up.
    try {
      await service.schema('app').from('household').delete().eq('id', hRow.id);
    } catch {
      // swallow: already in the error path.
    }
    throw new InternalError(`owner member insert failed: ${mErr?.message ?? 'no row returned'}`, {
      cause: mErr,
    });
  }

  // 3) full-write grants for the owner across every segment.
  const { error: gErr } = await service
    .schema('app')
    .from('member_segment_grant')
    .insert(
      DEFAULT_OWNER_GRANTS.map((g) => ({
        member_id: mRow.id,
        segment: g.segment,
        access: g.access,
      })),
    );
  if (gErr) {
    throw new InternalError(`owner grant insert failed: ${gErr.message}`, { cause: gErr });
  }

  // Audit.
  await writeAuditEvent(
    service,
    {
      household_id: hRow.id,
      actor_user_id: input.userId,
      action: AuditAction.HouseholdCreate,
      resource_type: 'household',
      resource_id: hRow.id,
      before: null,
      after: { name: hRow.name, settings: hRow.settings } as Json,
    },
    (err) => warn('audit write failed (household.create)', { err: String(err) }),
  );

  return {
    household: hRow,
    member: mRow,
    grants: DEFAULT_OWNER_GRANTS,
  };
}

// ---------------------------------------------------------------------------
// inviteMember
// ---------------------------------------------------------------------------

export interface InviteMemberResult {
  invitationId: string;
  token: string;
  tokenHash: string;
  expiresAt: string;
}

export async function inviteMember(
  service: FlowServiceClient,
  env: Pick<AuthServerEnv, 'INVITATION_TOKEN_SECRET' | 'INVITATION_TTL_DAYS'>,
  raw: InviteMemberInput,
): Promise<InviteMemberResult> {
  const parse = inviteMemberInputSchema.safeParse(raw);
  if (!parse.success) {
    throw zodFail('invalid inviteMember input', parse.error);
  }
  const input = parse.data;

  // Authorization check: the inviter must be an owner OR an adult with
  // social-write grant. `app.member_segment_grant` is the source of truth.
  const { data: inviter, error: inviterErr } = await service
    .schema('app')
    .from('member')
    .select('id, household_id, role, user_id')
    .eq('id', input.inviterMemberId)
    .eq('household_id', input.householdId)
    .maybeSingle();
  if (inviterErr) {
    throw new InternalError(`inviter lookup failed: ${inviterErr.message}`, { cause: inviterErr });
  }
  if (!inviter) {
    throw new NotFoundError('inviter member not found in household');
  }
  if (inviter.role !== 'owner' && inviter.role !== 'adult') {
    throw new ForbiddenError('only owners and adults can invite');
  }
  if (inviter.role === 'adult') {
    const { data: socialGrant } = await service
      .schema('app')
      .from('member_segment_grant')
      .select('access')
      .eq('member_id', inviter.id)
      .eq('segment', 'social')
      .maybeSingle();
    if (!socialGrant || socialGrant.access !== 'write') {
      throw new ForbiddenError('adult inviters need social:write');
    }
  }

  // Guard: don't issue a live invite for an email that's already an
  // accepted member. Re-issue is fine for pending invites (we just
  // replace the token).
  const { data: existingMember } = await service
    .schema('app')
    .from('member')
    .select('id')
    .eq('household_id', input.householdId)
    .eq('email', input.email)
    .not('user_id', 'is', null)
    .maybeSingle();
  if (existingMember) {
    throw new ConflictError('an accepted member already exists for this email');
  }

  const { token, tokenHash } = generateInvitationToken(env.INVITATION_TOKEN_SECRET);
  const ttl = env.INVITATION_TTL_DAYS ?? 7;
  const expiresAt = toIso(addDays(nowClock(), ttl));

  const { data: inv, error: invErr } = await service
    .schema('app')
    .from('household_invitation')
    .insert({
      household_id: input.householdId,
      email: input.email,
      role: input.role,
      proposed_grants: input.grants as unknown as Json,
      token_hash: tokenHash,
      expires_at: expiresAt,
      invited_by: input.inviterMemberId,
    })
    .select('id')
    .single();
  if (invErr || !inv) {
    throw new InternalError(`invitation insert failed: ${invErr?.message ?? 'no row'}`, {
      cause: invErr,
    });
  }

  await writeAuditEvent(
    service,
    {
      household_id: input.householdId,
      actor_user_id: inviter.user_id,
      action: AuditAction.HouseholdInvite,
      resource_type: 'household_invitation',
      resource_id: inv.id,
      before: null,
      after: {
        email: input.email,
        role: input.role,
        proposed_grants: input.grants,
        expires_at: expiresAt,
      } as Json,
    },
    (err) => warn('audit write failed (household.invite)', { err: String(err) }),
  );

  return { invitationId: inv.id, token, tokenHash, expiresAt };
}

// ---------------------------------------------------------------------------
// acceptInvitation
// ---------------------------------------------------------------------------

export interface AcceptInvitationResult {
  householdId: string;
  memberId: string;
  role: 'owner' | 'adult' | 'child' | 'guest';
  alreadyAccepted: boolean;
}

export async function acceptInvitation(
  service: FlowServiceClient,
  env: Pick<AuthServerEnv, 'INVITATION_TOKEN_SECRET'>,
  raw: AcceptInvitationInput,
  actor?: { email?: string | null },
): Promise<AcceptInvitationResult> {
  const parse = acceptInvitationInputSchema.safeParse(raw);
  if (!parse.success) {
    throw zodFail('invalid acceptInvitation input', parse.error);
  }
  const input = parse.data;

  const tokenHash = hashInvitationToken(input.token, env.INVITATION_TOKEN_SECRET);

  const { data: invRow, error: invErr } = await service
    .schema('app')
    .from('household_invitation')
    .select(
      'id, household_id, email, role, proposed_grants, token_hash, expires_at, accepted_at, accepted_by',
    )
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (invErr) {
    throw new InternalError(`invitation lookup failed: ${invErr.message}`, { cause: invErr });
  }
  if (!invRow) {
    throw new NotFoundError('invitation not found');
  }

  // Idempotency: if this user already has a member row (either from a
  // previous acceptance of this invite or a pre-existing non_connected
  // row that we upgraded) we return it.
  const { data: existing, error: existingErr } = await service
    .schema('app')
    .from('member')
    .select('id, role, joined_at')
    .eq('household_id', invRow.household_id)
    .eq('user_id', input.userId)
    .maybeSingle();
  if (existingErr) {
    throw new InternalError(`member lookup failed: ${existingErr.message}`, { cause: existingErr });
  }
  if (existing && invRow.accepted_at) {
    return {
      householdId: invRow.household_id,
      memberId: existing.id,
      role: existing.role as 'owner' | 'adult' | 'child' | 'guest',
      alreadyAccepted: true,
    };
  }

  if (new Date(invRow.expires_at).getTime() < Date.now()) {
    throw new ConflictError('invitation expired');
  }

  const displayName = actor?.email ?? invRow.email;

  // Upgrade path: an existing non_connected member with this email is
  // promoted in place (spec: `households.md` § Non-connected members).
  const { data: placeholder } = await service
    .schema('app')
    .from('member')
    .select('id, role, user_id')
    .eq('household_id', invRow.household_id)
    .eq('email', invRow.email)
    .is('user_id', null)
    .maybeSingle();

  let memberId: string;
  if (placeholder) {
    const { data: upgraded, error: upErr } = await service
      .schema('app')
      .from('member')
      .update({
        user_id: input.userId,
        role: invRow.role,
        joined_at: toIso(nowClock()),
        display_name: displayName,
      })
      .eq('id', placeholder.id)
      .select('id')
      .single();
    if (upErr || !upgraded) {
      throw new InternalError(`member upgrade failed: ${upErr?.message ?? 'no row'}`, {
        cause: upErr,
      });
    }
    memberId = upgraded.id;
  } else if (existing) {
    // User has a row but the invite was never accepted (crash mid-flow).
    // Reconcile role if it's different; otherwise no-op.
    if (existing.role !== invRow.role) {
      const { error: rErr } = await service
        .schema('app')
        .from('member')
        .update({ role: invRow.role, joined_at: existing.joined_at ?? toIso(nowClock()) })
        .eq('id', existing.id);
      if (rErr) {
        throw new InternalError(`member reconcile failed: ${rErr.message}`, { cause: rErr });
      }
    }
    memberId = existing.id;
  } else {
    const { data: ins, error: insErr } = await service
      .schema('app')
      .from('member')
      .insert({
        household_id: invRow.household_id,
        user_id: input.userId,
        display_name: displayName,
        role: invRow.role,
        joined_at: toIso(nowClock()),
        email: invRow.email,
      })
      .select('id')
      .single();
    if (insErr || !ins) {
      throw new InternalError(`member insert failed: ${insErr?.message ?? 'no row'}`, {
        cause: insErr,
      });
    }
    memberId = ins.id;
  }

  // Apply proposed grants. We upsert by (member_id, segment) because
  // the table has that unique constraint — this is idempotent across
  // retries.
  const grants =
    (invRow.proposed_grants as unknown as Array<{
      segment: 'financial' | 'food' | 'fun' | 'social' | 'system';
      access: 'none' | 'read' | 'write';
    }>) ?? [];

  if (grants.length > 0) {
    const { error: gErr } = await service
      .schema('app')
      .from('member_segment_grant')
      .upsert(
        grants.map((g) => ({ member_id: memberId, segment: g.segment, access: g.access })),
        { onConflict: 'member_id,segment' },
      );
    if (gErr) {
      throw new InternalError(`grant write failed: ${gErr.message}`, { cause: gErr });
    }
  }

  // Mark invitation accepted.
  const { error: markErr } = await service
    .schema('app')
    .from('household_invitation')
    .update({
      accepted_at: toIso(nowClock()),
      accepted_by: memberId,
    })
    .eq('id', invRow.id)
    .is('accepted_at', null);
  if (markErr) {
    // Not fatal — the invite is effectively accepted, just not marked.
    warn('could not mark invitation accepted', { err: markErr.message });
  }

  await writeAuditEvent(
    service,
    {
      household_id: invRow.household_id,
      actor_user_id: input.userId,
      action: AuditAction.HouseholdAcceptInvite,
      resource_type: 'household_invitation',
      resource_id: invRow.id,
      before: null,
      after: { member_id: memberId, role: invRow.role } as Json,
    },
    (err) => warn('audit write failed (household.invite.accept)', { err: String(err) }),
  );

  return {
    householdId: invRow.household_id,
    memberId,
    role: invRow.role as 'owner' | 'adult' | 'child' | 'guest',
    alreadyAccepted: false,
  };
}

// ---------------------------------------------------------------------------
// listHouseholds
// ---------------------------------------------------------------------------

export interface ListHouseholdsResult {
  household: { id: HouseholdId; name: string; settings: unknown };
  membership: { id: MemberId; role: 'owner' | 'adult' | 'child' | 'guest' | 'non_connected' };
}

export async function listHouseholds(
  service: FlowServiceClient,
  env: Pick<AuthServerEnv, never>,
  raw: ListHouseholdsInput,
): Promise<ListHouseholdsResult[]> {
  void env;
  const parse = listHouseholdsInputSchema.safeParse(raw);
  if (!parse.success) {
    throw zodFail('invalid listHouseholds input', parse.error);
  }
  const input = parse.data;

  const { data, error } = await service
    .schema('app')
    .from('member')
    .select('id, role, joined_at, household:household_id(id, name, settings)')
    .eq('user_id', input.userId)
    .order('joined_at', { ascending: true, nullsFirst: false });
  if (error) {
    throw new InternalError(`listHouseholds lookup failed: ${error.message}`, { cause: error });
  }

  return (data ?? []).flatMap((row) => {
    const h = row.household as
      | { id: string; name: string; settings: unknown }
      | Array<{ id: string; name: string; settings: unknown }>
      | null;
    const householdRow = Array.isArray(h) ? h[0] : h;
    if (!householdRow) return [];
    return [
      {
        household: {
          id: householdRow.id as HouseholdId,
          name: householdRow.name,
          settings: householdRow.settings ?? {},
        },
        membership: {
          id: row.id as MemberId,
          role: row.role as ListHouseholdsResult['membership']['role'],
        },
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// listMembers
// ---------------------------------------------------------------------------

export interface ListMembersResult {
  id: MemberId;
  displayName: string;
  role: 'owner' | 'adult' | 'child' | 'guest' | 'non_connected';
  joinedAt: string | null;
  grants: Array<{
    segment: 'financial' | 'food' | 'fun' | 'social' | 'system';
    access: 'none' | 'read' | 'write';
  }>;
  /** True when this row has an attached auth.users row. */
  connected: boolean;
}

export async function listMembers(
  service: FlowServiceClient,
  env: Pick<AuthServerEnv, never>,
  raw: ListMembersInput,
): Promise<ListMembersResult[]> {
  void env;
  const parse = listMembersInputSchema.safeParse(raw);
  if (!parse.success) {
    throw zodFail('invalid listMembers input', parse.error);
  }
  const input = parse.data;

  // Caller must be a member of the household they're asking about.
  const { data: requester, error: rErr } = await service
    .schema('app')
    .from('member')
    .select('id')
    .eq('id', input.requestorMemberId)
    .eq('household_id', input.householdId)
    .maybeSingle();
  if (rErr) {
    throw new InternalError(`requestor lookup failed: ${rErr.message}`, { cause: rErr });
  }
  if (!requester) {
    throw new ForbiddenError('requestor is not a member of this household');
  }

  const { data: members, error: mErr } = await service
    .schema('app')
    .from('member')
    .select('id, display_name, role, joined_at, user_id')
    .eq('household_id', input.householdId)
    .order('joined_at', { ascending: true, nullsFirst: false });
  if (mErr) {
    throw new InternalError(`member list failed: ${mErr.message}`, { cause: mErr });
  }

  const memberIds = (members ?? []).map((m) => m.id);
  let grantMap = new Map<string, ListMembersResult['grants']>();
  if (memberIds.length > 0) {
    const { data: grantRows, error: gErr } = await service
      .schema('app')
      .from('member_segment_grant')
      .select('member_id, segment, access')
      .in('member_id', memberIds);
    if (gErr) {
      throw new InternalError(`grant list failed: ${gErr.message}`, { cause: gErr });
    }
    grantMap = new Map();
    for (const g of grantRows ?? []) {
      const arr = grantMap.get(g.member_id) ?? [];
      arr.push({
        segment: g.segment as ListMembersResult['grants'][number]['segment'],
        access: g.access as ListMembersResult['grants'][number]['access'],
      });
      grantMap.set(g.member_id, arr);
    }
  }

  return (members ?? []).map((m) => ({
    id: m.id as MemberId,
    displayName: m.display_name,
    role: m.role as ListMembersResult['role'],
    joinedAt: m.joined_at,
    connected: m.user_id !== null,
    grants: grantMap.get(m.id) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// revokeMember
// ---------------------------------------------------------------------------

export async function revokeMember(
  service: FlowServiceClient,
  env: Pick<AuthServerEnv, never>,
  raw: RevokeMemberInput,
): Promise<{ ok: true }> {
  void env;
  const parse = revokeMemberInputSchema.safeParse(raw);
  if (!parse.success) {
    throw zodFail('invalid revokeMember input', parse.error);
  }
  const input = parse.data;

  // The actor must be an owner in the target household.
  const { data: actor } = await service
    .schema('app')
    .from('member')
    .select('id, role, user_id')
    .eq('id', input.actorMemberId)
    .eq('household_id', input.householdId)
    .maybeSingle();
  if (!actor || actor.role !== 'owner') {
    throw new ForbiddenError('only owners can revoke members');
  }
  if (actor.id === input.targetMemberId) {
    throw new ConflictError('cannot revoke yourself; transfer ownership first');
  }

  const { data: target } = await service
    .schema('app')
    .from('member')
    .select('id, role, display_name, user_id')
    .eq('id', input.targetMemberId)
    .eq('household_id', input.householdId)
    .maybeSingle();
  if (!target) {
    throw new NotFoundError('target member not found');
  }

  // Soft-revoke: drop to guest role, strip all grants. The member row
  // stays (spec open question: leave a "Bob (former member)" anchor for
  // the memory graph in M3; renaming to "former member" is an M8 follow-
  // up once mem.node is wired).
  const { error: uErr } = await service
    .schema('app')
    .from('member')
    .update({ role: 'guest' })
    .eq('id', target.id);
  if (uErr) {
    throw new InternalError(`revoke update failed: ${uErr.message}`, { cause: uErr });
  }
  const { error: gErr } = await service
    .schema('app')
    .from('member_segment_grant')
    .delete()
    .eq('member_id', target.id);
  if (gErr) {
    throw new InternalError(`revoke grant cleanup failed: ${gErr.message}`, { cause: gErr });
  }

  await writeAuditEvent(
    service,
    {
      household_id: input.householdId,
      actor_user_id: actor.user_id,
      action: AuditAction.HouseholdRevokeMember,
      resource_type: 'member',
      resource_id: target.id,
      before: { role: target.role, display_name: target.display_name } as Json,
      after: { role: 'guest', grants: [] } as Json,
    },
    (err) => warn('audit write failed (household.member.revoke)', { err: String(err) }),
  );

  return { ok: true };
}

// ---------------------------------------------------------------------------
// transferOwnership
// ---------------------------------------------------------------------------

export async function transferOwnership(
  service: FlowServiceClient,
  env: Pick<AuthServerEnv, never>,
  raw: TransferOwnershipInput,
): Promise<{ ok: true }> {
  void env;
  const parse = transferOwnershipInputSchema.safeParse(raw);
  if (!parse.success) {
    throw zodFail('invalid transferOwnership input', parse.error);
  }
  const input = parse.data;

  const { data: current } = await service
    .schema('app')
    .from('member')
    .select('id, role, user_id')
    .eq('id', input.currentOwnerMemberId)
    .eq('household_id', input.householdId)
    .maybeSingle();
  if (!current || current.role !== 'owner') {
    throw new ForbiddenError('current actor is not an owner');
  }
  const { data: target } = await service
    .schema('app')
    .from('member')
    .select('id, role, user_id')
    .eq('id', input.newOwnerMemberId)
    .eq('household_id', input.householdId)
    .maybeSingle();
  if (!target) {
    throw new NotFoundError('new owner not found');
  }
  if (target.role !== 'adult' && target.role !== 'owner') {
    throw new ConflictError('new owner must be an adult member');
  }
  if (target.user_id === null) {
    throw new ConflictError('new owner must be a connected member');
  }

  // Two updates. PostgREST has no multi-row update primitive that's
  // atomic across different WHERE clauses, so we accept the small window
  // where both are owners (that's fine — RLS permits both). If the
  // second update fails we roll back the first.
  const { error: e1 } = await service
    .schema('app')
    .from('member')
    .update({ role: 'owner' })
    .eq('id', target.id);
  if (e1) {
    throw new InternalError(`transfer step 1 failed: ${e1.message}`, { cause: e1 });
  }
  const { error: e2 } = await service
    .schema('app')
    .from('member')
    .update({ role: 'adult' })
    .eq('id', current.id);
  if (e2) {
    // Roll back step 1.
    try {
      await service.schema('app').from('member').update({ role: target.role }).eq('id', target.id);
    } catch {
      // Rollback best-effort; surface the original step-2 error.
    }
    throw new InternalError(`transfer step 2 failed: ${e2.message}`, { cause: e2 });
  }

  await writeAuditEvent(
    service,
    {
      household_id: input.householdId,
      actor_user_id: current.user_id,
      action: AuditAction.HouseholdTransferOwnership,
      resource_type: 'household',
      resource_id: input.householdId,
      before: { owner_member_id: current.id } as Json,
      after: { owner_member_id: target.id } as Json,
    },
    (err) => warn('audit write failed (household.ownership.transfer)', { err: String(err) }),
  );

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Helper: resolve a user's default member id for a given household.
// Useful to server actions that have a userId but need a memberId.
// ---------------------------------------------------------------------------

export async function resolveMemberId(
  service: FlowServiceClient,
  householdId: string,
  userId: string,
): Promise<string | null> {
  const { data, error } = await service
    .schema('app')
    .from('member')
    .select('id')
    .eq('household_id', householdId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    throw new InternalError(`resolveMemberId failed: ${error.message}`, { cause: error });
  }
  return data?.id ?? null;
}

// ---------------------------------------------------------------------------
// previewInvitation
// ---------------------------------------------------------------------------
//
// Added to support the `(public)/invite/[token]` accept-invitation flow in
// `@homehub/web`. Callers often need to render "You've been invited to
// <household> as <role>" BEFORE the invitee signs in, so the preview has
// to work without a session. Lookup is by hashed token — the same hash we
// already index on. This is a pure read; no audit event, no mutation.

export type InvitationStatus = 'valid' | 'expired' | 'accepted';

export interface PreviewInvitationResult {
  household: { id: string; name: string };
  role: 'owner' | 'adult' | 'child' | 'guest';
  email: string;
  inviterName: string | null;
  expiresAt: string;
  status: InvitationStatus;
}

export async function previewInvitation(
  service: FlowServiceClient,
  env: Pick<AuthServerEnv, 'INVITATION_TOKEN_SECRET'>,
  raw: PreviewInvitationInput,
): Promise<PreviewInvitationResult | null> {
  const parse = previewInvitationInputSchema.safeParse(raw);
  if (!parse.success) {
    throw zodFail('invalid previewInvitation input', parse.error);
  }
  const input = parse.data;

  const tokenHash = hashInvitationToken(input.token, env.INVITATION_TOKEN_SECRET);

  const { data: invRow, error: invErr } = await service
    .schema('app')
    .from('household_invitation')
    .select('id, household_id, email, role, expires_at, accepted_at, invited_by')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (invErr) {
    throw new InternalError(`invitation lookup failed: ${invErr.message}`, { cause: invErr });
  }
  if (!invRow) {
    return null;
  }

  const { data: household, error: hErr } = await service
    .schema('app')
    .from('household')
    .select('id, name')
    .eq('id', invRow.household_id)
    .maybeSingle();
  if (hErr) {
    throw new InternalError(`household lookup failed: ${hErr.message}`, { cause: hErr });
  }
  if (!household) {
    // FK guarantees this row exists; absence means the household was
    // hard-deleted — treat the invite as stale.
    return null;
  }

  let inviterName: string | null = null;
  if (invRow.invited_by) {
    const { data: inviter } = await service
      .schema('app')
      .from('member')
      .select('display_name')
      .eq('id', invRow.invited_by)
      .maybeSingle();
    inviterName = (inviter?.display_name as string | undefined) ?? null;
  }

  let status: InvitationStatus;
  if (invRow.accepted_at) {
    status = 'accepted';
  } else if (new Date(invRow.expires_at).getTime() < Date.now()) {
    status = 'expired';
  } else {
    status = 'valid';
  }

  return {
    household: { id: household.id as string, name: household.name as string },
    role: invRow.role as PreviewInvitationResult['role'],
    email: invRow.email as string,
    inviterName,
    expiresAt: invRow.expires_at as string,
    status,
  };
}

// ---------------------------------------------------------------------------
// updateHousehold
// ---------------------------------------------------------------------------
//
// Owner-only patch of the household row (name + settings fields the
// `(app)/settings/household` page exposes). We merge into the existing
// `settings` JSON rather than replace it so unrelated keys added by other
// features (approval policies in M5, notification prefs in M9) survive.

export interface UpdateHouseholdResult {
  household: Pick<HouseholdRow, 'id' | 'name' | 'settings'>;
}

export async function updateHousehold(
  service: FlowServiceClient,
  env: Pick<AuthServerEnv, never>,
  raw: UpdateHouseholdInput,
): Promise<UpdateHouseholdResult> {
  void env;
  const parse = updateHouseholdInputSchema.safeParse(raw);
  if (!parse.success) {
    throw zodFail('invalid updateHousehold input', parse.error);
  }
  const input = parse.data;

  const { data: actor } = await service
    .schema('app')
    .from('member')
    .select('id, role, user_id')
    .eq('id', input.actorMemberId)
    .eq('household_id', input.householdId)
    .maybeSingle();
  if (!actor || actor.role !== 'owner') {
    throw new ForbiddenError('only owners can update household settings');
  }

  const { data: current, error: cErr } = await service
    .schema('app')
    .from('household')
    .select('id, name, settings')
    .eq('id', input.householdId)
    .maybeSingle();
  if (cErr) {
    throw new InternalError(`household lookup failed: ${cErr.message}`, { cause: cErr });
  }
  if (!current) {
    throw new NotFoundError('household not found');
  }

  const settings: Record<string, Json> = {
    ...((current.settings as Record<string, Json> | null) ?? {}),
  };
  if (input.timezone) settings.timezone = input.timezone;
  if (input.currency) settings.currency = input.currency;
  if (input.weekStart) settings.week_start = input.weekStart;

  const patch: Database['app']['Tables']['household']['Update'] = {
    settings: settings as Json,
  };
  if (input.name) patch.name = input.name;

  const { data: updated, error: uErr } = await service
    .schema('app')
    .from('household')
    .update(patch)
    .eq('id', input.householdId)
    .select('id, name, settings')
    .single();
  if (uErr || !updated) {
    throw new InternalError(`household update failed: ${uErr?.message ?? 'no row'}`, {
      cause: uErr,
    });
  }

  await writeAuditEvent(
    service,
    {
      household_id: input.householdId,
      actor_user_id: actor.user_id,
      action: AuditAction.HouseholdUpdate,
      resource_type: 'household',
      resource_id: input.householdId,
      before: { name: current.name, settings: current.settings } as Json,
      after: { name: updated.name, settings: updated.settings } as Json,
    },
    (err) => warn('audit write failed (household.update)', { err: String(err) }),
  );

  return {
    household: {
      id: updated.id as HouseholdRow['id'],
      name: updated.name as HouseholdRow['name'],
      settings: updated.settings as HouseholdRow['settings'],
    },
  };
}

// ---------------------------------------------------------------------------
// listInvitations
// ---------------------------------------------------------------------------
//
// List pending (unaccepted, unexpired) invitations for a household. Used by
// the settings/members page to render "Pending" next to the "Invite" form.
// Any member can see the list; owner-only controls live in the UI layer.

export interface ListInvitationsResult {
  id: string;
  email: string;
  role: 'owner' | 'adult' | 'child' | 'guest';
  expiresAt: string;
  createdAt: string;
  invitedByDisplayName: string | null;
  token: null;
}

export async function listInvitations(
  service: FlowServiceClient,
  env: Pick<AuthServerEnv, never>,
  raw: ListInvitationsInput,
): Promise<ListInvitationsResult[]> {
  void env;
  const parse = listInvitationsInputSchema.safeParse(raw);
  if (!parse.success) {
    throw zodFail('invalid listInvitations input', parse.error);
  }
  const input = parse.data;

  const { data: requester } = await service
    .schema('app')
    .from('member')
    .select('id')
    .eq('id', input.requestorMemberId)
    .eq('household_id', input.householdId)
    .maybeSingle();
  if (!requester) {
    throw new ForbiddenError('requestor is not a member of this household');
  }

  const { data: rows, error } = await service
    .schema('app')
    .from('household_invitation')
    .select('id, email, role, expires_at, created_at, accepted_at, invited_by')
    .eq('household_id', input.householdId)
    .is('accepted_at', null)
    .order('created_at', { ascending: false });
  if (error) {
    throw new InternalError(`invitation list failed: ${error.message}`, { cause: error });
  }

  // Resolve inviter display names in a second query. Small N; no join.
  const inviterIds = Array.from(
    new Set((rows ?? []).map((r) => r.invited_by).filter((x): x is string => !!x)),
  );
  const nameById = new Map<string, string>();
  if (inviterIds.length > 0) {
    const { data: inviters } = await service
      .schema('app')
      .from('member')
      .select('id, display_name')
      .in('id', inviterIds);
    for (const i of inviters ?? []) {
      nameById.set(i.id as string, (i.display_name as string | null) ?? '');
    }
  }

  const nowMs = Date.now();
  return (rows ?? [])
    .filter((r) => new Date(r.expires_at as string).getTime() >= nowMs)
    .map((r) => ({
      id: r.id as string,
      email: r.email as string,
      role: r.role as ListInvitationsResult['role'],
      expiresAt: r.expires_at as string,
      createdAt: r.created_at as string,
      invitedByDisplayName: r.invited_by ? (nameById.get(r.invited_by as string) ?? null) : null,
      token: null,
    }));
}
