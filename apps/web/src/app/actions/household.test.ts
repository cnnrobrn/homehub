/**
 * Server-action envelope tests.
 *
 * These tests assert the action-layer contract: Zod-parsed input, session
 * lookup, and the `ActionResult<T>` envelope. They mock `@homehub/auth-server`
 * so the flow logic itself is covered by that package's own suite — the
 * value here is the thin wrapper (error shape, session branch, schema).
 *
 * Mocks use vitest's `vi.hoisted` so the module stubs bind before the
 * action module imports them.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mocks, FakeUnauthorizedError, FakeAuthServerError, FakeValidationError } = vi.hoisted(
  () => {
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
    class FakeValidationError extends FakeAuthServerError {
      override code = 'VALIDATION';
      issues: Array<{ path: string; message: string }> = [];
    }
    return {
      mocks: {
        getUser: vi.fn(),
        createServiceClient: vi.fn(() => ({ tag: 'service' })),
        createHousehold: vi.fn(),
        inviteMember: vi.fn(),
        acceptInvitation: vi.fn(),
        listHouseholds: vi.fn(),
        previewInvitation: vi.fn(),
        updateHousehold: vi.fn(),
        resolveMemberId: vi.fn(),
      },
      FakeUnauthorizedError,
      FakeAuthServerError,
      FakeValidationError,
    };
  },
);

vi.mock('@homehub/auth-server', () => ({
  getUser: mocks.getUser,
  createServiceClient: mocks.createServiceClient,
  createHousehold: mocks.createHousehold,
  inviteMember: mocks.inviteMember,
  acceptInvitation: mocks.acceptInvitation,
  listHouseholds: mocks.listHouseholds,
  previewInvitation: mocks.previewInvitation,
  updateHousehold: mocks.updateHousehold,
  resolveMemberId: mocks.resolveMemberId,
  UnauthorizedError: FakeUnauthorizedError,
  AuthServerError: FakeAuthServerError,
  ValidationError: FakeValidationError,
}));

vi.mock('@/lib/auth/env', () => ({
  authEnv: () => ({ INVITATION_TOKEN_SECRET: 'x'.repeat(64), INVITATION_TTL_DAYS: 7 }),
}));

vi.mock('@/lib/auth/cookies', () => ({
  nextCookieAdapter: async () => ({ getAll: () => [], setAll: () => {} }),
}));

// Import after the mocks so the envelope resolves them.
import {
  acceptInvitationAction,
  createHouseholdAction,
  inviteMemberAction,
  listHouseholdsAction,
  previewInvitationAction,
  updateHouseholdAction,
} from './household';

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'o@example.com' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createHouseholdAction', () => {
  it('returns { ok: true, data } on success', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.createHousehold.mockResolvedValue({
      household: { id: 'h1', name: 'Casa' },
      member: { id: 'm1' },
      grants: [],
    });
    const res = await createHouseholdAction({ name: 'Casa' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.household.name).toBe('Casa');
  });

  it('returns { ok: false } on invalid input', async () => {
    mocks.getUser.mockResolvedValue(USER);
    const res = await createHouseholdAction({ name: '' } as never);
    expect(res.ok).toBe(false);
  });

  it('returns { ok: false } when unauthenticated', async () => {
    mocks.getUser.mockResolvedValue(null);
    const res = await createHouseholdAction({ name: 'X' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('UNAUTHORIZED');
  });
});

describe('inviteMemberAction', () => {
  it('resolves member id then calls the flow', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.resolveMemberId.mockResolvedValue('m1');
    mocks.inviteMember.mockResolvedValue({
      invitationId: 'i1',
      token: 'tok',
      tokenHash: 'h',
      expiresAt: '2026-12-31T00:00:00Z',
    });
    const res = await inviteMemberAction({
      householdId: '22222222-2222-4222-8222-222222222222',
      email: 'a@b.com',
      role: 'adult',
      grants: [],
    });
    expect(res.ok).toBe(true);
    expect(mocks.inviteMember).toHaveBeenCalled();
  });

  it('rejects invalid input', async () => {
    mocks.getUser.mockResolvedValue(USER);
    const res = await inviteMemberAction({
      householdId: 'not-a-uuid',
      email: 'nope',
      role: 'adult',
      grants: [],
    } as never);
    expect(res.ok).toBe(false);
  });
});

describe('acceptInvitationAction', () => {
  it('requires a session', async () => {
    mocks.getUser.mockResolvedValue(null);
    const res = await acceptInvitationAction({ token: 't' });
    expect(res.ok).toBe(false);
  });

  it('forwards to the flow on success', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.acceptInvitation.mockResolvedValue({
      householdId: 'h1',
      memberId: 'm1',
      role: 'adult',
      alreadyAccepted: false,
    });
    const res = await acceptInvitationAction({ token: 't' });
    expect(res.ok).toBe(true);
  });
});

describe('listHouseholdsAction', () => {
  it('returns the list on success', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.listHouseholds.mockResolvedValue([]);
    const res = await listHouseholdsAction();
    expect(res.ok).toBe(true);
  });
});

describe('previewInvitationAction', () => {
  it('works without a session (read-only, token lookup)', async () => {
    mocks.getUser.mockResolvedValue(null);
    mocks.previewInvitation.mockResolvedValue({
      household: { id: 'h1', name: 'Casa' },
      role: 'adult',
      email: 'p@example.com',
      inviterName: 'Owner',
      expiresAt: '2026-12-31T00:00:00Z',
      status: 'valid',
    });
    const res = await previewInvitationAction({ token: 't' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data?.status).toBe('valid');
  });

  it('rejects invalid input', async () => {
    const res = await previewInvitationAction({ token: '' } as never);
    expect(res.ok).toBe(false);
  });
});

describe('updateHouseholdAction', () => {
  it('succeeds when caller resolves to a member', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.resolveMemberId.mockResolvedValue('m1');
    mocks.updateHousehold.mockResolvedValue({
      household: { id: 'h1', name: 'New', settings: {} },
    });
    const res = await updateHouseholdAction({
      householdId: '22222222-2222-4222-8222-222222222222',
      name: 'New',
    });
    expect(res.ok).toBe(true);
  });

  it('rejects bogus timezone length', async () => {
    mocks.getUser.mockResolvedValue(USER);
    const res = await updateHouseholdAction({
      householdId: '22222222-2222-4222-8222-222222222222',
      timezone: '',
    } as never);
    expect(res.ok).toBe(false);
  });

  it('errors when caller is not a member of the target household', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.resolveMemberId.mockResolvedValue(null);
    const res = await updateHouseholdAction({
      householdId: '22222222-2222-4222-8222-222222222222',
      name: 'X',
    });
    expect(res.ok).toBe(false);
  });
});
