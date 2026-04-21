/**
 * Tests for the memory server actions.
 *
 * Scope:
 *   - Happy path: envelope, audit call, candidate shape.
 *   - Auth failure: no session → UNAUTHORIZED envelope.
 *   - Validation: invalid input → ok:false with envelope.
 *
 * Mocks the auth-server package and a tiny Supabase shim that
 * records inserts/updates so we can assert on table + columns.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mocks,
  FakeAuthServerError,
  FakeUnauthorizedError,
  FakeValidationError,
  supabaseState,
  resetSupabaseState,
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
    rows: Map<string, unknown>;
    fact: unknown;
    node: unknown;
    inserts: Array<{ schema: string; table: string; row: Record<string, unknown> }>;
    updates: Array<{ schema: string; table: string; patch: Record<string, unknown> }>;
    audit: Array<Record<string, unknown>>;
  } = {
    rows: new Map(),
    fact: null,
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
      writeAuditEvent: vi.fn(async (_client: unknown, row: Record<string, unknown>) => {
        state.audit.push(row);
      }),
    },
    FakeAuthServerError,
    FakeUnauthorizedError,
    FakeValidationError,
    supabaseState: state,
    resetSupabaseState() {
      state.rows = new Map();
      state.fact = null;
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
          // Prefixed with `_` to silence the unused-var lint. The
          // debug string is handy when sprinkling `console.log` into
          // these tests locally.
          const _key = `${schemaName}.${table}`;
          void _key;
          let pendingInsert: Record<string, unknown> | null = null;
          let pendingUpdate: Record<string, unknown> | null = null;
          let wantSingle = false;

          const thenable = {
            select() {
              return thenable;
            },
            single() {
              wantSingle = true;
              return thenable;
            },
            maybeSingle() {
              // Resolve synchronously.
              const row =
                table === 'fact'
                  ? supabaseState.fact
                  : table === 'node'
                    ? supabaseState.node
                    : table === 'member'
                      ? { role: 'owner' }
                      : null;
              return Promise.resolve({ data: row, error: null });
            },
            eq() {
              return thenable;
            },
            neq() {
              return thenable;
            },
            then(resolve: (v: { data: unknown; error: null }) => void) {
              if (pendingInsert) {
                supabaseState.inserts.push({
                  schema: schemaName,
                  table,
                  row: pendingInsert,
                });
                const id = `id-${supabaseState.inserts.length}`;
                resolve({ data: wantSingle ? { id } : [{ id }], error: null });
                pendingInsert = null;
              } else if (pendingUpdate) {
                supabaseState.updates.push({
                  schema: schemaName,
                  table,
                  patch: pendingUpdate,
                });
                resolve({ data: null, error: null });
                pendingUpdate = null;
              } else {
                // A bare select without maybeSingle (used for
                // sub-selects we don't hit in these tests).
                resolve({ data: [], error: null });
              }
            },
          } as Record<string, unknown>;

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
  authEnv: () => ({ INVITATION_TOKEN_SECRET: 'x'.repeat(64), INVITATION_TTL_DAYS: 7 }),
}));

vi.mock('@/lib/auth/cookies', () => ({
  nextCookieAdapter: async () => ({ getAll: () => [], setAll: () => {} }),
}));

vi.mock('@/lib/memory/query', () => ({
  queryHouseholdMemory: vi.fn(async () => ({
    nodes: [],
    facts: [],
    episodes: [],
    edges: [],
    patterns: [],
    conflicts: [],
  })),
}));

// Import after mocks bind.
import {
  confirmFactAction,
  disputeFactAction,
  editFactAction,
  deleteFactAction,
  updateManualNotesAction,
  toggleNeedsReviewAction,
  pinNodeAction,
  mergeNodesAction,
  deleteNodeAction,
  searchMemoryAction,
} from './memory';

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'o@example.com' };
const HOUSEHOLD = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const FACT_ID = '44444444-4444-4444-8444-444444444444';
const NODE_ID = '55555555-5555-4555-8555-555555555555';
const PRIMARY_NODE_ID = '66666666-6666-4666-8666-666666666666';

const FAKE_FACT = {
  id: FACT_ID,
  household_id: HOUSEHOLD,
  subject_node_id: NODE_ID,
  predicate: 'age',
  object_value: 31,
  object_node_id: null,
  confidence: 0.8,
  evidence: [],
  valid_from: '2026-04-01T00:00:00Z',
  valid_to: null,
  recorded_at: '2026-04-01T00:00:00Z',
  superseded_at: null,
  superseded_by: null,
  source: 'extraction',
  reinforcement_count: 1,
  last_reinforced_at: '2026-04-01T00:00:00Z',
  conflict_status: 'none',
};

const FAKE_NODE = {
  id: NODE_ID,
  household_id: HOUSEHOLD,
  type: 'person',
  canonical_name: 'Sarah',
  document_md: null,
  manual_notes_md: null,
  metadata: {},
  embedding: null,
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-10T00:00:00Z',
  needs_review: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  resetSupabaseState();
  mocks.createServiceClient.mockReturnValue(makeFakeSupabase());
});

describe('confirmFactAction', () => {
  it('writes a member-sourced candidate + audit row on success', async () => {
    supabaseState.fact = FAKE_FACT;
    mocks.getUser.mockResolvedValue(USER);
    mocks.resolveMemberId.mockResolvedValue(MEMBER);
    const res = await confirmFactAction({ factId: FACT_ID });
    expect(res.ok).toBe(true);
    const inserts = supabaseState.inserts.filter((i) => i.table === 'fact_candidate');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.row.source).toBe('member');
    expect(inserts[0]?.row.confidence).toBe(1.0);
    const audits = supabaseState.audit;
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('mem.fact.confirmed');
  });

  it('fails when no session', async () => {
    supabaseState.fact = FAKE_FACT;
    mocks.getUser.mockResolvedValue(null);
    const res = await confirmFactAction({ factId: FACT_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('UNAUTHORIZED');
  });

  it('fails on invalid input', async () => {
    const res = await confirmFactAction({ factId: 'not-a-uuid' } as never);
    expect(res.ok).toBe(false);
  });
});

describe('disputeFactAction', () => {
  it('writes candidate + flips fact conflict_status + audits', async () => {
    supabaseState.fact = FAKE_FACT;
    mocks.getUser.mockResolvedValue(USER);
    mocks.resolveMemberId.mockResolvedValue(MEMBER);
    const res = await disputeFactAction({ factId: FACT_ID, reason: 'wrong age' });
    expect(res.ok).toBe(true);
    expect(supabaseState.inserts.some((i) => i.table === 'fact_candidate')).toBe(true);
    expect(
      supabaseState.updates.some(
        (u) => u.table === 'fact' && u.patch.conflict_status === 'unresolved',
      ),
    ).toBe(true);
    expect(supabaseState.audit[0]?.action).toBe('mem.fact.disputed');
  });

  it('rejects empty reason', async () => {
    const res = await disputeFactAction({ factId: FACT_ID, reason: '' });
    expect(res.ok).toBe(false);
  });
});

describe('editFactAction', () => {
  it('creates a new candidate with the updated object', async () => {
    supabaseState.fact = FAKE_FACT;
    mocks.getUser.mockResolvedValue(USER);
    mocks.resolveMemberId.mockResolvedValue(MEMBER);
    const res = await editFactAction({ factId: FACT_ID, newObjectValue: 32 });
    expect(res.ok).toBe(true);
    const insert = supabaseState.inserts.find((i) => i.table === 'fact_candidate');
    expect(insert?.row.object_value).toBe(32);
    expect(insert?.row.source).toBe('member');
  });

  it('rejects when neither new value nor new node id is provided', async () => {
    const res = await editFactAction({ factId: FACT_ID } as never);
    expect(res.ok).toBe(false);
  });
});

describe('deleteFactAction', () => {
  it('writes a null-object candidate with marker reason', async () => {
    supabaseState.fact = FAKE_FACT;
    mocks.getUser.mockResolvedValue(USER);
    mocks.resolveMemberId.mockResolvedValue(MEMBER);
    const res = await deleteFactAction({ factId: FACT_ID, reason: 'not true' });
    expect(res.ok).toBe(true);
    const insert = supabaseState.inserts.find((i) => i.table === 'fact_candidate');
    expect(insert?.row.object_value).toBeNull();
    expect(insert?.row.reason).toBe('not true');
    expect(supabaseState.audit[0]?.action).toBe('mem.fact.deleted');
  });
});

describe('updateManualNotesAction', () => {
  it('updates manual_notes_md on the node', async () => {
    supabaseState.node = FAKE_NODE;
    mocks.getUser.mockResolvedValue(USER);
    mocks.resolveMemberId.mockResolvedValue(MEMBER);
    const res = await updateManualNotesAction({
      nodeId: NODE_ID,
      markdown: 'Loves pasta',
    });
    expect(res.ok).toBe(true);
    const update = supabaseState.updates.find((u) => u.table === 'node');
    expect(update?.patch.manual_notes_md).toBe('Loves pasta');
  });

  it('rejects markdown over 16_000 chars', async () => {
    const res = await updateManualNotesAction({
      nodeId: NODE_ID,
      markdown: 'a'.repeat(16_001),
    });
    expect(res.ok).toBe(false);
  });
});

describe('toggleNeedsReviewAction', () => {
  it('flips the current value', async () => {
    supabaseState.node = { ...FAKE_NODE, needs_review: false };
    mocks.getUser.mockResolvedValue(USER);
    mocks.resolveMemberId.mockResolvedValue(MEMBER);
    const res = await toggleNeedsReviewAction({ nodeId: NODE_ID });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.needs_review).toBe(true);
    const update = supabaseState.updates.find((u) => u.table === 'node');
    expect(update?.patch.needs_review).toBe(true);
  });
});

describe('pinNodeAction', () => {
  it('stores member id in pinned_by_member_ids', async () => {
    supabaseState.node = { ...FAKE_NODE, metadata: {} };
    mocks.getUser.mockResolvedValue(USER);
    mocks.resolveMemberId.mockResolvedValue(MEMBER);
    const res = await pinNodeAction({ nodeId: NODE_ID });
    expect(res.ok).toBe(true);
    const update = supabaseState.updates.find((u) => u.table === 'node');
    const meta = update?.patch.metadata as Record<string, unknown>;
    expect(meta?.pinned_by_member_ids).toContain(MEMBER);
  });
});

describe('mergeNodesAction', () => {
  it('rejects non-owner', async () => {
    supabaseState.node = FAKE_NODE;
    mocks.getUser.mockResolvedValue(USER);
    mocks.resolveMemberId.mockResolvedValue(MEMBER);
    // Override the member role lookup for this test: re-wire the
    // fake supabase so member returns role='adult'.
    const adultSupabase = {
      ...makeFakeSupabase(),
      schema(schemaName: string) {
        return {
          from(table: string) {
            const base = makeFakeSupabase().schema(schemaName).from(table);
            if (table === 'member') {
              return {
                ...base,
                select() {
                  return {
                    ...base,
                    eq() {
                      return {
                        maybeSingle: () =>
                          Promise.resolve({ data: { role: 'adult' }, error: null }),
                      };
                    },
                  };
                },
              };
            }
            return base;
          },
        };
      },
    };
    mocks.createServiceClient.mockReturnValue(adultSupabase);

    const res = await mergeNodesAction({
      primaryNodeId: PRIMARY_NODE_ID,
      mergeNodeId: NODE_ID,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects merging a node with itself', async () => {
    const res = await mergeNodesAction({
      primaryNodeId: NODE_ID,
      mergeNodeId: NODE_ID,
    });
    expect(res.ok).toBe(false);
  });
});

describe('deleteNodeAction', () => {
  it('rejects non-owner', async () => {
    supabaseState.node = FAKE_NODE;
    mocks.getUser.mockResolvedValue(USER);
    mocks.resolveMemberId.mockResolvedValue(MEMBER);
    const adultSupabase = {
      schema(_schema: string) {
        return {
          from(table: string) {
            const chain: Record<string, unknown> = {
              select() {
                return chain;
              },
              eq() {
                return chain;
              },
              maybeSingle() {
                if (table === 'node') return Promise.resolve({ data: FAKE_NODE, error: null });
                if (table === 'member')
                  return Promise.resolve({ data: { role: 'adult' }, error: null });
                return Promise.resolve({ data: null, error: null });
              },
              then() {},
              update() {
                return chain;
              },
            };
            return chain;
          },
        };
      },
    };
    mocks.createServiceClient.mockReturnValue(adultSupabase);

    const res = await deleteNodeAction({ nodeId: NODE_ID, reason: 'duplicate' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('UNAUTHORIZED');
  });
});

describe('searchMemoryAction', () => {
  it('returns a serialized result', async () => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.resolveMemberId.mockResolvedValue(MEMBER);
    const res = await searchMemoryAction({
      householdId: HOUSEHOLD,
      query: 'pizza',
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.nodes).toEqual([]);
  });

  it('rejects empty query', async () => {
    const res = await searchMemoryAction({ householdId: HOUSEHOLD, query: '' });
    expect(res.ok).toBe(false);
  });
});
