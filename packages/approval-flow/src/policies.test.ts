import { describe, expect, it } from 'vitest';

import { AUTO_APPROVAL_DENY_LIST, DEFAULT_POLICIES, getPolicyFor } from './policies.js';
import { type SuggestionRow } from './types.js';

function makeSuggestion(kind: string, overrides: Partial<SuggestionRow> = {}): SuggestionRow {
  return {
    id: 's1',
    household_id: 'h1',
    segment: 'fun',
    kind,
    title: 't',
    rationale: 'r',
    preview: { foo: 'bar' },
    status: 'pending',
    created_at: '2025-01-01T00:00:00Z',
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  };
}

describe('getPolicyFor', () => {
  it('returns a quorum=1 policy by default for known kinds', () => {
    const p = getPolicyFor('outing_idea');
    expect(p.requiresQuorum).toBe(1);
    expect(p.autoApproveWhen).toBeUndefined();
  });

  it('returns a quorum=1 policy for unknown kinds (safe default)', () => {
    const p = getPolicyFor('some_unknown_kind');
    expect(p.requiresQuorum).toBe(1);
    expect(p.autoApproveWhen).toBeUndefined();
  });

  it('adds autoApproveWhen when kind is in settings.auto_approve_kinds', () => {
    const p = getPolicyFor('outing_idea', {
      approval: { auto_approve_kinds: ['outing_idea', 'meal_swap'] },
    });
    expect(p.autoApproveWhen).toBeDefined();
    expect(p.autoApproveWhen!(makeSuggestion('outing_idea'), {})).toBe(true);
  });

  it('never auto-approves destructive kinds (cancel_subscription)', () => {
    const p = getPolicyFor('cancel_subscription', {
      approval: { auto_approve_kinds: ['cancel_subscription'] },
    });
    expect(p.autoApproveWhen).toBeUndefined();
  });

  it('never auto-approves destructive kinds (propose_transfer)', () => {
    const p = getPolicyFor('propose_transfer', {
      approval: { auto_approve_kinds: ['propose_transfer'] },
    });
    expect(p.autoApproveWhen).toBeUndefined();
  });

  it('never auto-approves destructive kinds (settle_shared_expense)', () => {
    const p = getPolicyFor('settle_shared_expense', {
      approval: { auto_approve_kinds: ['settle_shared_expense'] },
    });
    expect(p.autoApproveWhen).toBeUndefined();
  });

  it('exposes a canonical hash function', () => {
    const p = getPolicyFor('outing_idea');
    const a = p.hashCanonical({
      kind: 'outing_idea',
      household_id: 'h1',
      preview: { foo: 1 },
    });
    const b = p.hashCanonical({
      kind: 'outing_idea',
      household_id: 'h1',
      preview: { foo: 1 },
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('AUTO_APPROVAL_DENY_LIST', () => {
  it('contains every destructive kind enumerated in the brief', () => {
    expect(AUTO_APPROVAL_DENY_LIST.has('cancel_subscription')).toBe(true);
    expect(AUTO_APPROVAL_DENY_LIST.has('propose_transfer')).toBe(true);
    expect(AUTO_APPROVAL_DENY_LIST.has('settle_shared_expense')).toBe(true);
    expect(AUTO_APPROVAL_DENY_LIST.has('transfer_funds')).toBe(true);
  });
});

describe('DEFAULT_POLICIES', () => {
  it('covers the starter kinds', () => {
    expect(DEFAULT_POLICIES.outing_idea).toBeDefined();
    expect(DEFAULT_POLICIES.meal_swap).toBeDefined();
    expect(DEFAULT_POLICIES.grocery_order).toBeDefined();
    expect(DEFAULT_POLICIES.reach_out).toBeDefined();
    expect(DEFAULT_POLICIES.cancel_subscription).toBeDefined();
    expect(DEFAULT_POLICIES.propose_transfer).toBeDefined();
  });
});
