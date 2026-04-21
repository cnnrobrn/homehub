/**
 * Ops server-action tests.
 *
 * Focus: owner-role enforcement on each mutating action. The DLQ
 * primitives are covered by the `@homehub/dlq-admin` package tests; here
 * we make sure a non-owner invocation returns `UNAUTHORIZED` and that
 * the mutating action is never called.
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
        writeAuditEvent: vi.fn(),
        getHouseholdContext: vi.fn(),
        listDeadLetters: vi.fn(),
        replayDeadLetter: vi.fn(),
        purgeDeadLetter: vi.fn(),
        createQueueClient: vi.fn(() => ({ send: vi.fn() })),
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
  writeAuditEvent: mocks.writeAuditEvent,
  UnauthorizedError: FakeUnauthorizedError,
  AuthServerError: FakeAuthServerError,
  ValidationError: FakeValidationError,
}));

vi.mock('@homehub/dlq-admin', () => ({
  listDeadLetters: mocks.listDeadLetters,
  replayDeadLetter: mocks.replayDeadLetter,
  purgeDeadLetter: mocks.purgeDeadLetter,
}));

vi.mock('@homehub/worker-runtime', () => ({
  createQueueClient: mocks.createQueueClient,
}));

vi.mock('@/lib/auth/context', () => ({
  getHouseholdContext: mocks.getHouseholdContext,
}));

vi.mock('@/lib/auth/env', () => ({
  authEnv: () => ({}),
}));

vi.mock('@/lib/auth/cookies', () => ({
  nextCookieAdapter: async () => ({ getAll: () => [], setAll: () => {} }),
}));

import { listDlqEntriesAction, purgeDlqEntryAction, replayDlqEntryAction } from './ops';

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'o@example.com' };
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const DLQ_ID = '44444444-4444-4444-8444-444444444444';

function ownerCtx() {
  return {
    household: { id: HOUSEHOLD_ID, name: 'Test', settings: {} },
    member: { id: MEMBER_ID, role: 'owner' },
    grants: [],
  };
}

function adultCtx() {
  return {
    household: { id: HOUSEHOLD_ID, name: 'Test', settings: {} },
    member: { id: MEMBER_ID, role: 'adult' },
    grants: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listDlqEntriesAction', () => {
  it('returns UNAUTHORIZED when not signed in', async () => {
    mocks.getUser.mockResolvedValue(null);
    const res = await listDlqEntriesAction({});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('UNAUTHORIZED');
    expect(mocks.listDeadLetters).not.toHaveBeenCalled();
  });

  it('returns UNAUTHORIZED for non-owner roles', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.getHouseholdContext.mockResolvedValue(adultCtx());
    const res = await listDlqEntriesAction({});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('UNAUTHORIZED');
    expect(mocks.listDeadLetters).not.toHaveBeenCalled();
  });

  it('lists entries when the caller is an owner', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.getHouseholdContext.mockResolvedValue(ownerCtx());
    mocks.resolveMemberId.mockResolvedValue(MEMBER_ID);
    mocks.listDeadLetters.mockResolvedValue([
      {
        id: DLQ_ID,
        queue: 'q',
        error: 'boom',
        receivedAt: '2026-04-20T00:00:00Z',
        messageId: 1,
        payload: {},
        connectionId: null,
        householdId: HOUSEHOLD_ID,
      },
    ]);
    const res = await listDlqEntriesAction({});
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.entries).toHaveLength(1);
  });
});

describe('replayDlqEntryAction', () => {
  it('rejects non-owner', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.getHouseholdContext.mockResolvedValue(adultCtx());
    const res = await replayDlqEntryAction({ id: DLQ_ID });
    expect(res.ok).toBe(false);
    expect(mocks.replayDeadLetter).not.toHaveBeenCalled();
  });

  it('replays and writes an audit event when owner', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.getHouseholdContext.mockResolvedValue(ownerCtx());
    mocks.resolveMemberId.mockResolvedValue(MEMBER_ID);
    mocks.replayDeadLetter.mockResolvedValue({ enqueued: true });
    const res = await replayDlqEntryAction({ id: DLQ_ID });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.enqueued).toBe(true);
    expect(mocks.writeAuditEvent).toHaveBeenCalled();
    const callArgs = mocks.writeAuditEvent.mock.calls[0];
    expect(callArgs?.[1]).toMatchObject({
      household_id: HOUSEHOLD_ID,
      action: 'ops.dlq.replay',
      resource_id: DLQ_ID,
    });
  });
});

describe('purgeDlqEntryAction', () => {
  it('rejects non-owner', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.getHouseholdContext.mockResolvedValue(adultCtx());
    const res = await purgeDlqEntryAction({ id: DLQ_ID });
    expect(res.ok).toBe(false);
    expect(mocks.purgeDeadLetter).not.toHaveBeenCalled();
  });

  it('purges and writes an audit event when owner', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.getHouseholdContext.mockResolvedValue(ownerCtx());
    mocks.resolveMemberId.mockResolvedValue(MEMBER_ID);
    mocks.purgeDeadLetter.mockResolvedValue(undefined);
    const res = await purgeDlqEntryAction({ id: DLQ_ID });
    expect(res.ok).toBe(true);
    expect(mocks.purgeDeadLetter).toHaveBeenCalledWith(expect.anything(), DLQ_ID);
    expect(mocks.writeAuditEvent).toHaveBeenCalled();
  });

  it('rejects invalid id shape', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.getHouseholdContext.mockResolvedValue(ownerCtx());
    const res = await purgeDlqEntryAction({ id: 'not-a-uuid' });
    expect(res.ok).toBe(false);
    expect(mocks.purgeDeadLetter).not.toHaveBeenCalled();
  });
});
