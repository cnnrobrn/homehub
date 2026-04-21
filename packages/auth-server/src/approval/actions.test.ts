/**
 * Unit tests for the approval server-action helpers.
 *
 * Uses the existing household-flows in-memory fake. The helpers accept
 * a `__serviceClient` and `__householdContext` override for tests so
 * we don't need to monkey-patch `createClient`.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  type FakeStore,
  createFakeSupabase,
  createStore,
} from '../household/__fixtures__/fake-supabase.js';

import {
  approveSuggestionAction,
  getApprovalStateAction,
  rejectSuggestionAction,
} from './actions.js';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
};

const COOKIES = {
  getAll: () => [] as Array<{ name: string; value: string }>,
};

let store: FakeStore;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supa: any;

beforeEach(() => {
  store = createStore();
  supa = createFakeSupabase(store);

  // Seed one household + one owner member + write grants.
  store.app.household!.rows.push({
    id: 'h1',
    name: 'Test',
    settings: {},
  });
  store.app.member!.rows.push({
    id: 'm1',
    household_id: 'h1',
    user_id: 'u1',
    role: 'owner',
  });
  store.app.member_segment_grant!.rows.push({
    id: 'g1',
    member_id: 'm1',
    household_id: 'h1',
    segment: 'fun',
    access: 'write',
  });
  store.app.suggestion!.rows.push({
    id: 's1',
    household_id: 'h1',
    segment: 'fun',
    kind: 'outing_idea',
    title: 'Test',
    rationale: 'r',
    preview: { place: 'park' },
    status: 'pending',
    created_at: '2025-01-01T00:00:00Z',
    resolved_at: null,
    resolved_by: null,
  });
});

const CONTEXT = {
  member: { id: 'm1' },
  household: { id: 'h1', settings: {} },
  grants: [{ segment: 'fun', access: 'write' }],
  userId: 'u1',
};

describe('approveSuggestionAction', () => {
  it('approves a pending suggestion and writes audit', async () => {
    const state = await approveSuggestionAction({
      env: ENV,
      cookies: COOKIES,
      suggestionId: 's1',
      __serviceClient: supa,
      __householdContext: CONTEXT,
    });
    expect(state.suggestion.status).toBe('approved');
    const audits = store.audit.event!.rows.map((e) => e.action);
    expect(audits).toContain('suggestion.approved');
  });

  it('rejects when suggestion does not exist', async () => {
    await expect(
      approveSuggestionAction({
        env: ENV,
        cookies: COOKIES,
        suggestionId: 'missing',
        __serviceClient: supa,
        __householdContext: CONTEXT,
      }),
    ).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('rejects when caller lacks write access to the segment', async () => {
    // Overwrite the grant to read-only.
    store.app.member_segment_grant!.rows[0]!.access = 'read';
    await expect(
      approveSuggestionAction({
        env: ENV,
        cookies: COOKIES,
        suggestionId: 's1',
        __serviceClient: supa,
        __householdContext: {
          ...CONTEXT,
          grants: [{ segment: 'fun', access: 'read' }],
        },
      }),
    ).rejects.toMatchObject({ name: 'ForbiddenError' });
  });
});

describe('rejectSuggestionAction', () => {
  it('marks suggestion rejected', async () => {
    await rejectSuggestionAction({
      env: ENV,
      cookies: COOKIES,
      suggestionId: 's1',
      reason: 'Not interested',
      __serviceClient: supa,
      __householdContext: CONTEXT,
    });
    expect(store.app.suggestion!.rows[0]!.status).toBe('rejected');
    const audits = store.audit.event!.rows.map((e) => e.action);
    expect(audits).toContain('suggestion.rejected');
  });
});

describe('getApprovalStateAction', () => {
  it('returns a snapshot with no approvers on a fresh suggestion', async () => {
    const state = await getApprovalStateAction({
      env: ENV,
      cookies: COOKIES,
      suggestionId: 's1',
      __serviceClient: supa,
      __householdContext: CONTEXT,
    });
    expect(state.suggestion.id).toBe('s1');
    expect(state.approvers).toEqual([]);
    expect(state.quorumMet).toBe(false);
  });
});
