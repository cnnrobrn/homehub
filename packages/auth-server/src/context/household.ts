/**
 * `getHouseholdContext` / `requireHouseholdContext`.
 *
 * Resolves (household, member, segment grants) for the current user in
 * one round trip. Called on virtually every authenticated server render,
 * so it needs to be small and RLS-aware — the queries below all run
 * under the member-scoped client, which means RLS provides a second line
 * of defense: if the user is not actually a member, the queries return
 * zero rows and we map that to `null`.
 *
 * Caching: the caller is expected to wrap this with React's `cache()` at
 * the import boundary (e.g. in `apps/web/src/lib/auth.ts`) so repeated
 * Server Component calls within one request don't re-query. We don't
 * wrap here because this package is framework-agnostic and must stay
 * importable from plain Node workers too (M2+); `react/cache` would
 * pull React in as a peer dependency.
 */

import { type HouseholdId, type MemberId } from '@homehub/shared';

import { type CookieAdapter, createServerClient } from '../clients/index.js';
import { type AuthServerEnv } from '../env.js';
import {
  ForbiddenError,
  InternalError,
  NotFoundError,
  UnauthorizedError,
} from '../errors/index.js';

import { getUser } from './session.js';

export type Segment = 'financial' | 'food' | 'fun' | 'social' | 'system';
export type Access = 'none' | 'read' | 'write';
export type Role = 'owner' | 'adult' | 'child' | 'guest' | 'non_connected';

export interface HouseholdContext {
  household: { id: HouseholdId; name: string; settings: unknown };
  member: { id: MemberId; role: Role };
  grants: Array<{ segment: Segment; access: Access }>;
}

export interface GetHouseholdContextArgs {
  householdId?: HouseholdId | string;
}

export async function getHouseholdContext(
  env: Pick<AuthServerEnv, 'SUPABASE_URL' | 'SUPABASE_ANON_KEY'>,
  cookies: CookieAdapter,
  args: GetHouseholdContextArgs = {},
): Promise<HouseholdContext | null> {
  const user = await getUser(env, cookies);
  if (!user) return null;

  const client = createServerClient(env, cookies);

  // Pull the caller's memberships. RLS: `member_read` policy allows
  // members to see member rows in their households; we filter further
  // to the caller's own rows by joining to their user_id.
  const memberQuery = client
    .schema('app')
    .from('member')
    .select('id, household_id, role, joined_at, household:household_id(id, name, settings)')
    .eq('user_id', user.id);

  const { data: memberRows, error: memberErr } = args.householdId
    ? await memberQuery.eq('household_id', args.householdId).limit(1)
    : await memberQuery.order('joined_at', { ascending: true, nullsFirst: false }).limit(1);

  if (memberErr) {
    throw new InternalError(`member lookup failed: ${memberErr.message}`, { cause: memberErr });
  }
  if (!memberRows || memberRows.length === 0) {
    return null;
  }
  const memberRow = memberRows[0]!;

  // `household` comes back as an array-or-object depending on the
  // PostgREST relationship cardinality. Normalize.
  const householdRaw = memberRow.household as
    | { id: string; name: string; settings: unknown }
    | Array<{ id: string; name: string; settings: unknown }>
    | null;
  const household = Array.isArray(householdRaw) ? householdRaw[0] : householdRaw;
  if (!household) {
    // Extremely unlikely — FK enforces referential integrity. Defensive.
    throw new InternalError(`member ${memberRow.id} references missing household`);
  }

  const { data: grantRows, error: grantErr } = await client
    .schema('app')
    .from('member_segment_grant')
    .select('segment, access')
    .eq('member_id', memberRow.id);
  if (grantErr) {
    throw new InternalError(`member_segment_grant lookup failed: ${grantErr.message}`, {
      cause: grantErr,
    });
  }

  return {
    household: {
      id: household.id as HouseholdId,
      name: household.name,
      settings: household.settings ?? {},
    },
    member: {
      id: memberRow.id as MemberId,
      role: memberRow.role as Role,
    },
    grants: (grantRows ?? []).map((g) => ({
      segment: g.segment as Segment,
      access: g.access as Access,
    })),
  };
}

export async function requireHouseholdContext(
  env: Pick<AuthServerEnv, 'SUPABASE_URL' | 'SUPABASE_ANON_KEY'>,
  cookies: CookieAdapter,
  args: GetHouseholdContextArgs = {},
): Promise<HouseholdContext> {
  const user = await getUser(env, cookies);
  if (!user) {
    throw new UnauthorizedError('no session');
  }
  const ctx = await getHouseholdContext(env, cookies, args);
  if (!ctx) {
    // User is signed in but has no matching membership. If a specific
    // household was asked for, that's a forbidden; otherwise the user
    // simply has no household yet (not-found — UI should route to the
    // create-household onboarding).
    if (args.householdId) {
      throw new ForbiddenError(`not a member of household ${args.householdId}`);
    }
    throw new NotFoundError('user is not a member of any household');
  }
  return ctx;
}
