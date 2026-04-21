/**
 * Tests for the financial server actions.
 *
 * - happy path: envelope, audit, row shape.
 * - auth failure: no session → UNAUTHORIZED envelope.
 * - validation: invalid input → ok:false.
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

  const state: {
    alert: unknown;
    node: unknown;
    inserts: Array<{ schema: string; table: string; row: Record<string, unknown> }>;
    updates: Array<{ schema: string; table: string; patch: Record<string, unknown> }>;
    audit: Array<Record<string, unknown>>;
  } = {
    alert: null,
    node: null,
    inserts: [],
    updates: [],
    audit: [],
  };

  return {
    mocks: {
      getUser: vi.fn(),
      resolveMemberId: vi.fn(),
      createServiceClient: vi.fn(),
      writeAuditEvent: vi.fn(async (_c: unknown, row: Record<string, unknown>) => {
        state.audit.push(row);
      }),
    },
    FakeAuthServerError,
    FakeUnauthorizedError,
    FakeValidationError,
    state,
    resetState() {
      state.alert = null;
      state.node = null;
      state.inserts = [];
      state.updates = [];
      state.audit = [];
    },
  };
});

function makeFakeSupabase() {
  return {
    schema(schemaName: string) {
      return {
        from(table: string) {
          let pendingInsert: Record<string, unknown> | null = null;
          let pendingUpdate: Record<string, unknown> | null = null;
          let wantSingle = false;
          const thenable: Record<string, unknown> = {
            select() {
              return thenable;
            },
            single() {
              wantSingle = true;
              return thenable;
            },
            maybeSingle() {
              const row =
                table === 'alert'
                  ? state.alert
                  : table === 'node'
                    ? state.node
                    : table === 'member'
                      ? { role: 'owner' }
                      : null;
              return Promise.resolve({ data: row, error: null });
            },
            eq() {
              return thenable;
            },
            then(resolve: (v: { data: unknown; error: null }) => void) {
              if (pendingInsert) {
                state.inserts.push({ schema: schemaName, table, row: pendingInsert });
                const id = `id-${state.inserts.length}`;
                resolve({ data: wantSingle ? { id } : [{ id }], error: null });
                pendingInsert = null;
              } else if (pendingUpdate) {
                state.updates.push({ schema: schemaName, table, patch: pendingUpdate });
                resolve({ data: null, error: null });
                pendingUpdate = null;
              } else {
                resolve({ data: [], error: null });
              }
            },
          };
          return {
            ...thenable,
            insert(row: Record<string, unknown>) {
              pendingInsert = row;
              return thenable;
            },
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
  resolveMemberId: mocks.resolveMemberId,
  createServiceClient: mocks.createServiceClient,
  writeAuditEvent: mocks.writeAuditEvent,
  UnauthorizedError: FakeUnauthorizedError,
  AuthServerError: FakeAuthServerError,
  ValidationError: FakeValidationError,
}));

vi.mock('@/lib/auth/env', () => ({
  authEnv: () => ({}),
}));

vi.mock('@/lib/auth/cookies', () => ({
  nextCookieAdapter: async () => ({ getAll: () => [], setAll: () => {} }),
}));

import { dismissAlertAction, proposeCancelSubscriptionAction } from './financial';

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'o@example.com' };
const HOUSEHOLD = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const ALERT_ID = '44444444-4444-4444-8444-444444444444';
const NODE_ID = '55555555-5555-4555-8555-555555555555';

beforeEach(() => {
  vi.clearAllMocks();
  resetState();
  mocks.createServiceClient.mockReturnValue(makeFakeSupabase());
});

describe('dismissAlertAction', () => {
  it('sets dismissed_at + dismissed_by + audits', async () => {
    state.alert = {
      id: ALERT_ID,
      household_id: HOUSEHOLD,
      segment: 'financial',
      dismissed_at: null,
    };
    mocks.getUser.mockResolvedValue(USER);
    mocks.resolveMemberId.mockResolvedValue(MEMBER);
    const res = await dismissAlertAction({ alertId: ALERT_ID });
    expect(res.ok).toBe(true);
    const update = state.updates.find((u) => u.table === 'alert');
    expect(update).toBeDefined();
    expect(update?.patch['dismissed_by']).toBe(MEMBER);
    expect(typeof update?.patch['dismissed_at']).toBe('string');
    expect(state.audit[0]?.['action']).toBe('app.alert.dismissed');
  });

  it('no-ops when already dismissed', async () => {
    state.alert = {
      id: ALERT_ID,
      household_id: HOUSEHOLD,
      segment: 'financial',
      dismissed_at: '2026-04-19T00:00:00Z',
    };
    mocks.getUser.mockResolvedValue(USER);
    mocks.resolveMemberId.mockResolvedValue(MEMBER);
    const res = await dismissAlertAction({ alertId: ALERT_ID });
    expect(res.ok).toBe(true);
    expect(state.updates.filter((u) => u.table === 'alert')).toHaveLength(0);
  });

  it('fails when no session', async () => {
    state.alert = {
      id: ALERT_ID,
      household_id: HOUSEHOLD,
      segment: 'financial',
      dismissed_at: null,
    };
    mocks.getUser.mockResolvedValue(null);
    const res = await dismissAlertAction({ alertId: ALERT_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('UNAUTHORIZED');
  });

  it('fails on invalid input', async () => {
    const res = await dismissAlertAction({ alertId: 'not-a-uuid' } as never);
    expect(res.ok).toBe(false);
  });

  it('fails when alert not found', async () => {
    state.alert = null;
    mocks.getUser.mockResolvedValue(USER);
    mocks.resolveMemberId.mockResolvedValue(MEMBER);
    const res = await dismissAlertAction({ alertId: ALERT_ID });
    expect(res.ok).toBe(false);
  });
});

describe('proposeCancelSubscriptionAction', () => {
  it('inserts a pending suggestion with kind=cancel_subscription', async () => {
    state.node = {
      id: NODE_ID,
      household_id: HOUSEHOLD,
      type: 'subscription',
      canonical_name: 'Netflix',
    };
    mocks.getUser.mockResolvedValue(USER);
    mocks.resolveMemberId.mockResolvedValue(MEMBER);
    const res = await proposeCancelSubscriptionAction({ subscriptionNodeId: NODE_ID });
    expect(res.ok).toBe(true);
    const insert = state.inserts.find((i) => i.table === 'suggestion');
    expect(insert).toBeDefined();
    expect(insert?.row['kind']).toBe('cancel_subscription');
    expect(insert?.row['status']).toBe('pending');
    expect(insert?.row['segment']).toBe('financial');
    expect((insert?.row['preview'] as Record<string, unknown>)['subscription_node_id']).toBe(
      NODE_ID,
    );
    expect(state.audit[0]?.['action']).toBe('app.suggestion.proposed');
  });

  it('fails when the node is not a subscription', async () => {
    state.node = {
      id: NODE_ID,
      household_id: HOUSEHOLD,
      type: 'person',
      canonical_name: 'Sarah',
    };
    mocks.getUser.mockResolvedValue(USER);
    mocks.resolveMemberId.mockResolvedValue(MEMBER);
    const res = await proposeCancelSubscriptionAction({ subscriptionNodeId: NODE_ID });
    expect(res.ok).toBe(false);
  });

  it('fails when unauthenticated', async () => {
    state.node = {
      id: NODE_ID,
      household_id: HOUSEHOLD,
      type: 'subscription',
      canonical_name: 'Netflix',
    };
    mocks.getUser.mockResolvedValue(null);
    const res = await proposeCancelSubscriptionAction({ subscriptionNodeId: NODE_ID });
    expect(res.ok).toBe(false);
  });

  it('fails on invalid uuid', async () => {
    const res = await proposeCancelSubscriptionAction({
      subscriptionNodeId: 'nope',
    } as never);
    expect(res.ok).toBe(false);
  });
});
