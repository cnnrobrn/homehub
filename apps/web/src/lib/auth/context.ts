/**
 * Request-scoped household-context reader for Server Components.
 *
 * Wraps `@homehub/auth-server`'s `getHouseholdContext` with React's
 * `cache()` so repeated calls within one request tree (e.g. a layout
 * and multiple nested pages) hit the underlying query once.
 *
 * `cache()` is stable in React 19 and the docs recommend exactly this
 * pattern for auth resolvers. The cache is scoped to the current render
 * and cleared at the end of the request, so no cross-request leak risk.
 */

import {
  type HouseholdContext,
  getHouseholdContext as baseGetHouseholdContext,
  requireHouseholdContext as baseRequireHouseholdContext,
} from '@homehub/auth-server';
import { cookies as nextCookies } from 'next/headers';
import { cache } from 'react';

import { nextCookieAdapter } from './cookies';
import { authEnv } from './env';

/**
 * Cookie key used by `<HouseholdSwitcher />` to pin the active household
 * when the member belongs to more than one. If the cookie is absent or
 * the member is not part of the referenced household, the resolver falls
 * back to "oldest joined household" per `auth-server` default behavior.
 */
export const ACTIVE_HOUSEHOLD_COOKIE = 'hh_active_household';

async function resolveHouseholdHint(override?: string): Promise<string | undefined> {
  if (override !== undefined) return override;
  const store = await nextCookies();
  return store.get(ACTIVE_HOUSEHOLD_COOKIE)?.value;
}

export const getHouseholdContext = cache(
  async (householdId?: string): Promise<HouseholdContext | null> => {
    const cookies = await nextCookieAdapter();
    const hint = await resolveHouseholdHint(householdId);
    const args = hint !== undefined ? { householdId: hint } : {};
    const ctx = await baseGetHouseholdContext(authEnv(), cookies, args);
    if (ctx) return ctx;
    // If the cookie pointed at a household the member is no longer in,
    // fall back to "any household I belong to."
    if (hint !== undefined && !householdId) {
      return baseGetHouseholdContext(authEnv(), cookies);
    }
    return null;
  },
);

export const requireHouseholdContext = cache(
  async (householdId?: string): Promise<HouseholdContext> => {
    const cookies = await nextCookieAdapter();
    const hint = await resolveHouseholdHint(householdId);
    const args = hint !== undefined ? { householdId: hint } : {};
    return baseRequireHouseholdContext(authEnv(), cookies, args);
  },
);
