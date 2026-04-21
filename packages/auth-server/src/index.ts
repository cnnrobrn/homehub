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
  listInvitations,
  listMembers,
  previewInvitation,
  resolveMemberId,
  revokeMember,
  transferOwnership,
  updateHousehold,
  type AcceptInvitationResult,
  type CreateHouseholdResult,
  type InvitationStatus,
  type InviteMemberResult,
  type ListHouseholdsResult,
  type ListInvitationsResult,
  type ListMembersResult,
  type PreviewInvitationResult,
  type UpdateHouseholdResult,
} from './household/flows.js';

export {
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

export {
  approveSuggestionAction,
  getApprovalStateAction,
  rejectSuggestionAction,
  type ApprovalActionArgs,
  type RejectSuggestionActionArgs,
} from './approval/actions.js';
