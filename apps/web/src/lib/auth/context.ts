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
import { cache } from 'react';

import { nextCookieAdapter } from './cookies';
import { authEnv } from './env';

export const getHouseholdContext = cache(
  async (householdId?: string): Promise<HouseholdContext | null> => {
    const cookies = await nextCookieAdapter();
    const args = householdId !== undefined ? { householdId } : {};
    return baseGetHouseholdContext(authEnv(), cookies, args);
  },
);

export const requireHouseholdContext = cache(
  async (householdId?: string): Promise<HouseholdContext> => {
    const cookies = await nextCookieAdapter();
    const args = householdId !== undefined ? { householdId } : {};
    return baseRequireHouseholdContext(authEnv(), cookies, args);
  },
);
