/**
 * Tests for the unified suggestions server actions.
 *
 * The actions delegate to `@homehub/auth-server`'s
 * `approveSuggestionAction` / `rejectSuggestionAction` /
 * `getApprovalStateAction`. We mock those modules and prove:
 *
 *   - happy path returns the right `ActionResult` envelope,
 *   - Zod validation failure returns `{ ok: false }`,
 *   - auth failures bubble through the envelope translator.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mocks, FakeAuthServerError, FakeUnauthorizedError, FakeValidationError } = vi.hoisted(
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
      constructor(
        messageOrIssues: string | Array<{ path: string; message: string }>,
        maybeIssues?: Array<{ path: string; message: string }>,
      ) {
        super(typeof messageOrIssues === 'string' ? messageOrIssues : 'validation');
        this.issues = Array.isArray(messageOrIssues) ? messageOrIssues : (maybeIssues ?? []);
      }
    }

    return {
      mocks: {
        approveSuggestionAction: vi.fn(),
        rejectSuggestionAction: vi.fn(),
        getApprovalStateAction: vi.fn(),
      },
      FakeAuthServerError,
      FakeUnauthorizedError,
      FakeValidationError,
    };
  },
);

vi.mock('@homehub/auth-server', () => ({
  approveSuggestionAction: mocks.approveSuggestionAction,
  rejectSuggestionAction: mocks.rejectSuggestionAction,
  getApprovalStateAction: mocks.getApprovalStateAction,
  AuthServerError: FakeAuthServerError,
  UnauthorizedError: FakeUnauthorizedError,
  ValidationError: FakeValidationError,
}));

vi.mock('@/lib/auth/env', () => ({ authEnv: () => ({}) }));
vi.mock('@/lib/auth/cookies', () => ({
  nextCookieAdapter: async () => ({ getAll: () => [], setAll: () => {} }),
}));

import {
  approveSuggestionViaQueueAction,
  getSuggestionApprovalStateAction,
  rejectSuggestionViaQueueAction,
} from './suggestions';

const SUGGESTION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('approveSuggestionViaQueueAction', () => {
  it('returns ok + summary on happy path', async () => {
    mocks.approveSuggestionAction.mockResolvedValue({
      suggestion: { id: SUGGESTION_ID, status: 'approved' },
      approvers: [{ memberId: 'm1', approvedAt: '2026-04-20T12:00:00Z' }],
      quorumMet: true,
      eligibleToExecute: true,
    });
    const res = await approveSuggestionViaQueueAction({ suggestionId: SUGGESTION_ID });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.suggestionId).toBe(SUGGESTION_ID);
      expect(res.data.status).toBe('approved');
      expect(res.data.quorumMet).toBe(true);
    }
  });

  it('returns validation error on bad input', async () => {
    const res = await approveSuggestionViaQueueAction({
      suggestionId: 'not-a-uuid',
    } as never);
    expect(res.ok).toBe(false);
  });

  it('surfaces unauthorized errors through the envelope', async () => {
    mocks.approveSuggestionAction.mockRejectedValue(new FakeUnauthorizedError('no session'));
    const res = await approveSuggestionViaQueueAction({ suggestionId: SUGGESTION_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('UNAUTHORIZED');
  });
});

describe('rejectSuggestionViaQueueAction', () => {
  it('returns ok on happy path', async () => {
    mocks.rejectSuggestionAction.mockResolvedValue(undefined);
    const res = await rejectSuggestionViaQueueAction({ suggestionId: SUGGESTION_ID });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.suggestionId).toBe(SUGGESTION_ID);
  });

  it('passes reason through to the underlying helper', async () => {
    mocks.rejectSuggestionAction.mockResolvedValue(undefined);
    await rejectSuggestionViaQueueAction({ suggestionId: SUGGESTION_ID, reason: 'not needed' });
    expect(mocks.rejectSuggestionAction).toHaveBeenCalledWith(
      expect.objectContaining({ suggestionId: SUGGESTION_ID, reason: 'not needed' }),
    );
  });

  it('fails on bad input', async () => {
    const res = await rejectSuggestionViaQueueAction({ suggestionId: 'nope' } as never);
    expect(res.ok).toBe(false);
  });
});

describe('getSuggestionApprovalStateAction', () => {
  it('returns approval state summary', async () => {
    mocks.getApprovalStateAction.mockResolvedValue({
      suggestion: { id: SUGGESTION_ID, status: 'pending' },
      approvers: [],
      quorumMet: false,
      eligibleToExecute: false,
    });
    const res = await getSuggestionApprovalStateAction({ suggestionId: SUGGESTION_ID });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.status).toBe('pending');
  });

  it('fails on bad input', async () => {
    const res = await getSuggestionApprovalStateAction({ suggestionId: 'bad' } as never);
    expect(res.ok).toBe(false);
  });
});
