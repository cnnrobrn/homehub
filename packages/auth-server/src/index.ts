/**
 * `@homehub/auth-server` — server-only auth + household helpers.
 *
 * Public surface:
 *
 *   Clients
 *     - createServerClient(env, cookies)  — member-scoped Supabase client
 *     - createServiceClient(env)          — service-role client (RLS bypass)
 *
 *   Session
 *     - getSession(env, cookies)
 *     - getUser(env, cookies)
 *
 *   Household context
 *     - getHouseholdContext(env, cookies, { householdId? })
 *     - requireHouseholdContext(env, cookies, { householdId? })
 *
 *   Household flows (all accept an already-constructed service client)
 *     - createHousehold
 *     - inviteMember
 *     - acceptInvitation
 *     - listHouseholds
 *     - listMembers
 *     - revokeMember
 *     - transferOwnership
 *     - resolveMemberId  (utility)
 *
 *   Errors
 *     - ValidationError, UnauthorizedError, ForbiddenError, NotFoundError,
 *       ConflictError, InternalError (all extend AuthServerError)
 *
 *   Env
 *     - authServerEnvSchema + resolveAuthServerEnv
 *
 *   Invitation tokens (exported for tests / admin tooling)
 *     - generateInvitationToken, hashInvitationToken
 *
 *   Audit writer
 *     - writeAuditEvent, AuditAction
 */

export {
  createServerClient,
  createServiceClient,
  type CookieAdapter,
  type MemberSupabaseClient,
  type ServiceSupabaseClient,
} from './clients/index.js';

export { getSession, getUser, type SessionUser } from './context/session.js';

export {
  getHouseholdContext,
  requireHouseholdContext,
  type Access,
  type GetHouseholdContextArgs,
  type HouseholdContext,
  type Role,
  type Segment,
} from './context/household.js';

export {
  acceptInvitation,
  createHousehold,
  inviteMember,
  listHouseholds,
  listMembers,
  resolveMemberId,
  revokeMember,
  transferOwnership,
  type AcceptInvitationResult,
  type CreateHouseholdResult,
  type InviteMemberResult,
  type ListHouseholdsResult,
  type ListMembersResult,
} from './household/flows.js';

export {
  acceptInvitationInputSchema,
  createHouseholdInputSchema,
  inviteMemberInputSchema,
  listHouseholdsInputSchema,
  listMembersInputSchema,
  revokeMemberInputSchema,
  transferOwnershipInputSchema,
  type AcceptInvitationInput,
  type CreateHouseholdInput,
  type InviteMemberInput,
  type ListHouseholdsInput,
  type ListMembersInput,
  type RevokeMemberInput,
  type TransferOwnershipInput,
} from './household/schemas.js';

export {
  AuthServerError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from './errors/index.js';

export { authServerEnvSchema, resolveAuthServerEnv, type AuthServerEnv } from './env.js';

export {
  generateInvitationToken,
  hashInvitationToken,
  tokensMatch,
  type TokenPair,
} from './invitation/token.js';

export {
  AuditAction,
  writeAuditEvent,
  type AuditActionType,
  type AuditWriteInput,
} from './audit/index.js';
