/**
 * Tests for member-management server actions.
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
        resolveMemberId: vi.fn(),
        listMembers: vi.fn(),
        listInvitations: vi.fn(),
        revokeMember: vi.fn(),
        transferOwnership: vi.fn(),
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
  resolveMemberId: mocks.resolveMemberId,
  listMembers: mocks.listMembers,
  listInvitations: mocks.listInvitations,
  revokeMember: mocks.revokeMember,
  transferOwnership: mocks.transferOwnership,
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

import {
  listInvitationsAction,
  listMembersAction,
  revokeMemberAction,
  transferOwnershipAction,
} from './members';

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'o@example.com' };
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listMembersAction', () => {
  it('returns members on success', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.resolveMemberId.mockResolvedValue(MEMBER_ID);
    mocks.listMembers.mockResolvedValue([]);
    const res = await listMembersAction({ householdId: HOUSEHOLD_ID });
    expect(res.ok).toBe(true);
  });

  it('requires a session', async () => {
    mocks.getUser.mockResolvedValue(null);
    const res = await listMembersAction({ householdId: HOUSEHOLD_ID });
    expect(res.ok).toBe(false);
  });

  it('rejects invalid householdId', async () => {
    mocks.getUser.mockResolvedValue(USER);
    const res = await listMembersAction({ householdId: 'not-a-uuid' } as never);
    expect(res.ok).toBe(false);
  });
});

describe('listInvitationsAction', () => {
  it('returns invitations on success', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.resolveMemberId.mockResolvedValue(MEMBER_ID);
    mocks.listInvitations.mockResolvedValue([]);
    const res = await listInvitationsAction({ householdId: HOUSEHOLD_ID });
    expect(res.ok).toBe(true);
  });

  it('fails when not a member', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.resolveMemberId.mockResolvedValue(null);
    const res = await listInvitationsAction({ householdId: HOUSEHOLD_ID });
    expect(res.ok).toBe(false);
  });
});

describe('revokeMemberAction', () => {
  it('forwards on valid input', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.resolveMemberId.mockResolvedValue(MEMBER_ID);
    mocks.revokeMember.mockResolvedValue({ ok: true });
    const res = await revokeMemberAction({
      householdId: HOUSEHOLD_ID,
      targetMemberId: MEMBER_ID,
    });
    expect(res.ok).toBe(true);
  });

  it('rejects missing uuid', async () => {
    mocks.getUser.mockResolvedValue(USER);
    const res = await revokeMemberAction({
      householdId: HOUSEHOLD_ID,
      targetMemberId: 'bad',
    } as never);
    expect(res.ok).toBe(false);
  });
});

describe('transferOwnershipAction', () => {
  it('forwards on valid input', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.resolveMemberId.mockResolvedValue(MEMBER_ID);
    mocks.transferOwnership.mockResolvedValue({ ok: true });
    const res = await transferOwnershipAction({
      householdId: HOUSEHOLD_ID,
      newOwnerMemberId: MEMBER_ID,
    });
    expect(res.ok).toBe(true);
  });
});
