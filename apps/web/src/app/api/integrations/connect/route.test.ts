/**
 * Tests for the integration connect route.
 *
 * The route is intentionally thin, but the redirect target matters: the
 * browser must follow Nango's minted `connect_link`, not a URL rebuilt
 * from server-only Nango host config.
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mocks, FakeNangoNotConfiguredError, FakeUnauthorizedError } = vi.hoisted(() => {
  class FakeUnauthorizedError extends Error {}
  class FakeNangoNotConfiguredError extends Error {}

  return {
    FakeNangoNotConfiguredError,
    FakeUnauthorizedError,
    mocks: {
      authEnv: vi.fn(),
      createWebNangoClient: vi.fn(),
      getHouseholdContext: vi.fn(),
      getUser: vi.fn(),
      nextCookieAdapter: vi.fn(),
    },
  };
});

vi.mock('@homehub/auth-server', () => ({
  getUser: mocks.getUser,
  UnauthorizedError: FakeUnauthorizedError,
}));

vi.mock('@/lib/auth/context', () => ({
  getHouseholdContext: mocks.getHouseholdContext,
}));

vi.mock('@/lib/auth/cookies', () => ({
  nextCookieAdapter: mocks.nextCookieAdapter,
}));

vi.mock('@/lib/auth/env', () => ({
  authEnv: mocks.authEnv,
}));

vi.mock('@/lib/nango/client', () => ({
  createWebNangoClient: mocks.createWebNangoClient,
  NangoNotConfiguredError: FakeNangoNotConfiguredError,
}));

import { GET } from './route';

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com' };
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';

function request(path: string): NextRequest {
  return new NextRequest(`https://app.homehub.ing${path}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authEnv.mockReturnValue({ SUPABASE_URL: 'https://supabase.example.com' });
  mocks.nextCookieAdapter.mockResolvedValue({ getAll: () => [], setAll: () => {} });
  mocks.getUser.mockResolvedValue(USER);
  mocks.getHouseholdContext.mockResolvedValue({
    household: { id: HOUSEHOLD_ID },
    member: { id: MEMBER_ID },
    grants: [],
  });
});

describe('GET /api/integrations/connect', () => {
  it('redirects to the Nango-generated connect_link', async () => {
    const createConnectSession = vi.fn().mockResolvedValue({
      token: 'session-token',
      connectLink: 'https://connect.nango.dev/session/session-token',
      expiresAt: '2026-04-24T02:00:00Z',
    });
    mocks.createWebNangoClient.mockReturnValue({ createConnectSession });

    const response = await GET(request('/api/integrations/connect?provider=google-calendar'));

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'https://connect.nango.dev/session/session-token',
    );
    expect(createConnectSession).toHaveBeenCalledWith({
      endUser: {
        id: `member:${MEMBER_ID}`,
        email: USER.email,
        tags: {
          household_id: HOUSEHOLD_ID,
          member_id: MEMBER_ID,
          provider: 'google-calendar',
        },
      },
      allowedIntegrations: ['google-calendar'],
      tags: {
        household_id: HOUSEHOLD_ID,
        member_id: MEMBER_ID,
        provider: 'google-calendar',
      },
    });
  });

  it('returns a 502 if Nango omits a usable connect_link', async () => {
    mocks.createWebNangoClient.mockReturnValue({
      createConnectSession: vi.fn().mockResolvedValue({
        token: 'session-token',
        connectLink: '',
        expiresAt: '2026-04-24T02:00:00Z',
      }),
    });

    const response = await GET(request('/api/integrations/connect?provider=google-calendar'));
    const body = (await response.json()) as { error: string; detail: string };

    expect(response.status).toBe(502);
    expect(body.detail).toBe('Nango did not return a valid connect_link');
  });
});
