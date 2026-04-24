/**
 * Tests for integration server actions.
 *
 * Mocks `@homehub/auth-server` and `@/lib/auth/context` so we can pin
 * authorization behavior and branch coverage without a real Supabase.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mocks,
  FakeAuthServerError,
  FakeUnauthorizedError,
  FakeValidationError,
  FakeForbiddenError,
} = vi.hoisted(() => {
  class FakeAuthServerError extends Error {
    code = 'INTERNAL';
  }
  class FakeUnauthorizedError extends FakeAuthServerError {
    override code = 'UNAUTHORIZED';
    constructor(message: string) {
      super(message);
      this.name = 'UnauthorizedError';
    }
  }
  class FakeForbiddenError extends FakeAuthServerError {
    override code = 'FORBIDDEN';
    constructor(message: string) {
      super(message);
      this.name = 'ForbiddenError';
    }
  }
  class FakeValidationError extends FakeAuthServerError {
    override code = 'VALIDATION';
    issues: Array<{ path: string; message: string }> = [];
  }
  return {
    mocks: {
      getUser: vi.fn(),
      createServiceClient: vi.fn(),
      createServerClient: vi.fn(),
      resolveMemberId: vi.fn(),
      getHouseholdContext: vi.fn(),
      createWebNangoClient: vi.fn(),
    },
    FakeAuthServerError,
    FakeUnauthorizedError,
    FakeForbiddenError,
    FakeValidationError,
  };
});

vi.mock('@homehub/auth-server', () => ({
  getUser: mocks.getUser,
  createServiceClient: mocks.createServiceClient,
  createServerClient: mocks.createServerClient,
  resolveMemberId: mocks.resolveMemberId,
  UnauthorizedError: FakeUnauthorizedError,
  ForbiddenError: FakeForbiddenError,
  AuthServerError: FakeAuthServerError,
  ValidationError: FakeValidationError,
}));

vi.mock('@/lib/auth/env', () => ({
  authEnv: () => ({ INVITATION_TOKEN_SECRET: 'x'.repeat(64), INVITATION_TTL_DAYS: 7 }),
}));

vi.mock('@/lib/auth/cookies', () => ({
  nextCookieAdapter: async () => ({ getAll: () => [], setAll: () => {} }),
}));

vi.mock('@/lib/auth/context', () => ({
  getHouseholdContext: mocks.getHouseholdContext,
}));

vi.mock('@/lib/nango/client', () => ({
  createWebNangoClient: mocks.createWebNangoClient,
  NangoNotConfiguredError: class extends Error {},
}));

vi.mock('@/lib/env', () => ({
  publicEnv: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  },
  serverEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    NANGO_HOST: 'https://nango.test',
    NANGO_SECRET_KEY: 'secret',
  }),
}));

import {
  disconnectConnectionAction,
  listConnectionsAction,
  startConnectSessionAction,
} from './integrations';

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'o@example.com' };
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const CONNECTION_ID = '44444444-4444-4444-8444-444444444444';

function makeServerClient(rows: unknown[]) {
  return {
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: rows, error: null }),
          }),
        }),
      }),
    }),
  };
}

function makeServiceClient(opts: {
  connection?: unknown | null;
  updateError?: { message: string } | null;
}) {
  return {
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.connection ?? null, error: null }),
            }),
          }),
        }),
        update: () => ({
          eq: async () => ({ data: null, error: opts.updateError ?? null }),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listConnectionsAction', () => {
  it('returns rows on success', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.getHouseholdContext.mockResolvedValue({
      household: { id: HOUSEHOLD_ID },
      member: { id: MEMBER_ID, role: 'owner' },
      grants: [],
    });
    mocks.createServerClient.mockReturnValue(
      makeServerClient([
        {
          id: CONNECTION_ID,
          provider: 'gcal',
          nango_connection_id: 'nango-1',
          status: 'active',
          last_synced_at: '2026-04-20T12:00:00Z',
          member_id: MEMBER_ID,
        },
      ]),
    );
    const res = await listConnectionsAction();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toHaveLength(1);
      expect(res.data[0]?.provider).toBe('gcal');
    }
  });

  it('rejects unauthenticated callers', async () => {
    mocks.getUser.mockResolvedValue(null);
    const res = await listConnectionsAction();
    expect(res.ok).toBe(false);
  });

  it('rejects callers with no household', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.getHouseholdContext.mockResolvedValue(null);
    const res = await listConnectionsAction();
    expect(res.ok).toBe(false);
  });
});

describe('disconnectConnectionAction', () => {
  it('requires an authenticated owner', async () => {
    mocks.getUser.mockResolvedValue(null);
    const res = await disconnectConnectionAction({ connectionId: CONNECTION_ID });
    expect(res.ok).toBe(false);
  });

  it('rejects non-owners with FORBIDDEN', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.getHouseholdContext.mockResolvedValue({
      household: { id: HOUSEHOLD_ID },
      member: { id: MEMBER_ID, role: 'adult' },
      grants: [],
    });
    const res = await disconnectConnectionAction({ connectionId: CONNECTION_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('FORBIDDEN');
  });

  it('rejects invalid connectionId', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.getHouseholdContext.mockResolvedValue({
      household: { id: HOUSEHOLD_ID },
      member: { id: MEMBER_ID, role: 'owner' },
      grants: [],
    });
    const res = await disconnectConnectionAction({ connectionId: 'not-a-uuid' } as never);
    expect(res.ok).toBe(false);
  });

  it('happy path marks the connection revoked even if Nango delete fails', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.getHouseholdContext.mockResolvedValue({
      household: { id: HOUSEHOLD_ID },
      member: { id: MEMBER_ID, role: 'owner' },
      grants: [],
    });
    mocks.createServiceClient.mockReturnValue(
      makeServiceClient({
        connection: {
          id: CONNECTION_ID,
          household_id: HOUSEHOLD_ID,
          provider: 'gcal',
          nango_connection_id: 'nango-1',
        },
      }),
    );
    mocks.resolveMemberId.mockResolvedValue(MEMBER_ID);
    mocks.createWebNangoClient.mockReturnValue({
      deleteConnection: vi.fn().mockRejectedValue(new Error('nango 500')),
    });
    const res = await disconnectConnectionAction({ connectionId: CONNECTION_ID });
    expect(res.ok).toBe(true);
  });

  it('fails if the connection does not belong to the household', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.getHouseholdContext.mockResolvedValue({
      household: { id: HOUSEHOLD_ID },
      member: { id: MEMBER_ID, role: 'owner' },
      grants: [],
    });
    mocks.resolveMemberId.mockResolvedValue(MEMBER_ID);
    mocks.createServiceClient.mockReturnValue(makeServiceClient({ connection: null }));
    const res = await disconnectConnectionAction({ connectionId: CONNECTION_ID });
    expect(res.ok).toBe(false);
  });
});

describe('startConnectSessionAction', () => {
  it('returns a Nango connect URL for google-calendar', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.getHouseholdContext.mockResolvedValue({
      household: { id: HOUSEHOLD_ID },
      member: { id: MEMBER_ID, role: 'owner' },
      grants: [],
    });
    const createConnectSession = vi.fn().mockResolvedValue({
      token: 'tok_abc',
      connectLink: 'https://connect.nango.test/session/session-token',
      expiresAt: '2026-04-23T01:00:00Z',
    });
    mocks.createWebNangoClient.mockReturnValue({ createConnectSession });

    const res = await startConnectSessionAction({ provider: 'google-calendar' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.connectUrl).toBe('https://connect.nango.test/session/session-token');
    }
    expect(createConnectSession).toHaveBeenCalledTimes(1);
    const call = createConnectSession.mock.calls[0]?.[0];
    expect(call?.allowedIntegrations).toEqual(['google-calendar']);
    expect(call?.tags?.household_id).toBe(HOUSEHOLD_ID);
    expect(call?.tags?.member_id).toBe(MEMBER_ID);
  });

  it('rejects google-mail without any valid categories', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.getHouseholdContext.mockResolvedValue({
      household: { id: HOUSEHOLD_ID },
      member: { id: MEMBER_ID, role: 'owner' },
      grants: [],
    });
    const res = await startConnectSessionAction({
      provider: 'google-mail',
      categories: ['not-a-real-category'],
    });
    expect(res.ok).toBe(false);
  });

  it('passes email_categories tag for google-mail', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.getHouseholdContext.mockResolvedValue({
      household: { id: HOUSEHOLD_ID },
      member: { id: MEMBER_ID, role: 'owner' },
      grants: [],
    });
    const createConnectSession = vi.fn().mockResolvedValue({
      token: 't',
      connectLink: 'https://connect.nango.test/session/gmail',
      expiresAt: 'x',
    });
    mocks.createWebNangoClient.mockReturnValue({ createConnectSession });

    const res = await startConnectSessionAction({
      provider: 'google-mail',
      categories: ['receipt', 'shipping'],
    });
    expect(res.ok).toBe(true);
    const call = createConnectSession.mock.calls[0]?.[0];
    expect(call?.tags?.email_categories).toBe('receipt,shipping');
    expect(call?.tags?.email_address).toBe(USER.email);
  });

  it('rejects an invalid Nango connect_link', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.getHouseholdContext.mockResolvedValue({
      household: { id: HOUSEHOLD_ID },
      member: { id: MEMBER_ID, role: 'owner' },
      grants: [],
    });
    mocks.createWebNangoClient.mockReturnValue({
      createConnectSession: vi.fn().mockResolvedValue({
        token: 't',
        connectLink: '',
        expiresAt: 'x',
      }),
    });

    const res = await startConnectSessionAction({ provider: 'google-calendar' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.message).toContain('connect_link');
    }
  });

  it('rejects unauthenticated callers', async () => {
    mocks.getUser.mockResolvedValue(null);
    const res = await startConnectSessionAction({ provider: 'google-calendar' });
    expect(res.ok).toBe(false);
  });

  it('rejects unknown providers', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.getHouseholdContext.mockResolvedValue({
      household: { id: HOUSEHOLD_ID },
      member: { id: MEMBER_ID, role: 'owner' },
      grants: [],
    });
    const res = await startConnectSessionAction({ provider: 'not-a-provider' as never });
    expect(res.ok).toBe(false);
  });
});
