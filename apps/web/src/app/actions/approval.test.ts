/**
 * Tests for the auto-approval server actions.
 *
 * Validates: owner-only gating, deny-list filtering, audit writing,
 * and the `ActionResult` envelope on success + failure.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mocks,
  FakeAuthServerError,
  FakeUnauthorizedError,
  FakeValidationError,
  state,
  resetState,
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
  interface State {
    household: { id: string; settings: Record<string, unknown> } | null;
    audit: Array<{ action: string; after: unknown }>;
    auditEvents: Array<{
      id: string;
      action: string;
      resource_type: string;
      resource_id: string | null;
      at: string;
      actor_user_id: string | null;
    }>;
    updates: Array<{ table: string; patch: Record<string, unknown> }>;
  }
  const state: State = {
    household: null,
    audit: [],
    auditEvents: [],
    updates: [],
  };
  return {
    mocks: {
      getUser: vi.fn(),
      createServiceClient: vi.fn(),
      requireHouseholdContext: vi.fn(),
      writeAuditEvent: vi.fn(async (_c: unknown, row: { action: string; after: unknown }) => {
        state.audit.push(row);
      }),
    },
    FakeAuthServerError,
    FakeUnauthorizedError,
    FakeValidationError,
    state,
    resetState() {
      state.household = null;
      state.audit = [];
      state.auditEvents = [];
      state.updates = [];
    },
  };
});

function makeSupabase() {
  return {
    schema(schemaName: string) {
      return {
        from(table: string) {
          let pendingUpdate: Record<string, unknown> | null = null;
          const thenable: Record<string, unknown> = {
            select() {
              return thenable;
            },
            eq() {
              return thenable;
            },
            or() {
              return thenable;
            },
            order() {
              return thenable;
            },
            limit() {
              return thenable;
            },
            maybeSingle() {
              if (table === 'household') {
                return Promise.resolve({ data: state.household, error: null });
              }
              return Promise.resolve({ data: null, error: null });
            },
            then(resolve: (value: { data: unknown; error: null }) => void) {
              if (pendingUpdate) {
                state.updates.push({ table, patch: pendingUpdate });
                resolve({ data: null, error: null });
                pendingUpdate = null;
              } else if (schemaName === 'audit' && table === 'event') {
                resolve({ data: state.auditEvents, error: null });
              } else {
                resolve({ data: [], error: null });
              }
            },
          };
          return {
            ...thenable,
            update(patch: Record<string, unknown>) {
              pendingUpdate = patch;
              return thenable;
            },
          };
        },
      };
    },
  };
}

vi.mock('@homehub/auth-server', () => ({
  getUser: mocks.getUser,
  createServiceClient: mocks.createServiceClient,
  writeAuditEvent: mocks.writeAuditEvent,
  UnauthorizedError: FakeUnauthorizedError,
  AuthServerError: FakeAuthServerError,
  ValidationError: FakeValidationError,
}));

vi.mock('@/lib/auth/context', () => ({
  requireHouseholdContext: mocks.requireHouseholdContext,
}));

vi.mock('@/lib/auth/env', () => ({ authEnv: () => ({}) }));
vi.mock('@/lib/auth/cookies', () => ({
  nextCookieAdapter: async () => ({ getAll: () => [], setAll: () => {} }),
}));

import { listAutoApprovalAuditAction, updateAutoApprovalKindsAction } from './approval';

const HOUSEHOLD_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNER_CTX = {
  member: { id: 'm1', role: 'owner' as const },
  household: { id: HOUSEHOLD_ID, name: 'Test', settings: {} },
  grants: [],
};
const MEMBER_CTX = {
  member: { id: 'm1', role: 'adult' as const },
  household: { id: HOUSEHOLD_ID, name: 'Test', settings: {} },
  grants: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  resetState();
  state.household = { id: HOUSEHOLD_ID, settings: {} };
  mocks.createServiceClient.mockReturnValue(makeSupabase());
  mocks.getUser.mockResolvedValue({ id: 'u1', email: 'o@example.com' });
});

describe('updateAutoApprovalKindsAction', () => {
  it('saves the supplied kinds and writes audit when caller is owner', async () => {
    mocks.requireHouseholdContext.mockResolvedValue(OWNER_CTX);
    const res = await updateAutoApprovalKindsAction({
      kinds: ['outing_idea', 'meal_swap', 'grocery_order'],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.kinds).toContain('outing_idea');
      expect(res.data.kinds).toContain('meal_swap');
    }
    expect(state.updates.find((u) => u.table === 'household')).toBeDefined();
    expect(state.audit[0]?.action).toBe('household.approval.kinds_updated');
  });

  it('filters out destructive deny-listed kinds', async () => {
    mocks.requireHouseholdContext.mockResolvedValue(OWNER_CTX);
    const res = await updateAutoApprovalKindsAction({
      kinds: ['outing_idea', 'cancel_subscription', 'propose_transfer', 'settle_shared_expense'],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.kinds).toContain('outing_idea');
      expect(res.data.kinds).not.toContain('cancel_subscription');
      expect(res.data.kinds).not.toContain('propose_transfer');
      expect(res.data.kinds).not.toContain('settle_shared_expense');
    }
  });

  it('rejects non-owner members with UNAUTHORIZED', async () => {
    mocks.requireHouseholdContext.mockResolvedValue(MEMBER_CTX);
    const res = await updateAutoApprovalKindsAction({ kinds: ['outing_idea'] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects bad input', async () => {
    mocks.requireHouseholdContext.mockResolvedValue(OWNER_CTX);
    const res = await updateAutoApprovalKindsAction({ kinds: 'not-an-array' } as never);
    expect(res.ok).toBe(false);
  });
});

describe('listAutoApprovalAuditAction', () => {
  it('returns audit entries for the household', async () => {
    mocks.requireHouseholdContext.mockResolvedValue(OWNER_CTX);
    state.auditEvents.push({
      id: 'e1',
      action: 'suggestion.approved',
      resource_type: 'suggestion',
      resource_id: 'sug-1',
      at: '2026-04-20T12:00:00Z',
      actor_user_id: 'u1',
    });
    const res = await listAutoApprovalAuditAction({ limit: 10 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.entries.length).toBeGreaterThanOrEqual(1);
      expect(res.data.entries[0]?.action).toBe('suggestion.approved');
    }
  });

  it('rejects non-owner callers', async () => {
    mocks.requireHouseholdContext.mockResolvedValue(MEMBER_CTX);
    const res = await listAutoApprovalAuditAction({});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('UNAUTHORIZED');
  });
});
