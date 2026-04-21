/**
 * Unit tests for `detectAccountStale`.
 */

import { describe, expect, it } from 'vitest';

import { type AccountRow } from '../types.js';

import { ACCOUNT_STALE_THRESHOLD_HOURS, detectAccountStale } from './account-stale.js';

const HOUSEHOLD = 'h-1';

function acct(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'a-1',
    household_id: HOUSEHOLD,
    name: 'Checking',
    kind: 'checking',
    balance_cents: 100_000_00,
    currency: 'USD',
    last_synced_at: '2026-04-22T00:00:00Z',
    ...overrides,
  };
}

describe('detectAccountStale', () => {
  const now = new Date('2026-04-22T12:00:00Z');

  it('no alert when synced within window', () => {
    const out = detectAccountStale({
      householdId: HOUSEHOLD,
      accounts: [acct({ last_synced_at: '2026-04-22T00:00:00Z' })],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('emits warn when synced > 24h ago', () => {
    const out = detectAccountStale({
      householdId: HOUSEHOLD,
      accounts: [acct({ last_synced_at: '2026-04-20T00:00:00Z' })],
      now,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe('warn');
    expect(out[0]!.kind).toBe('account_stale');
    expect(out[0]!.dedupeKey).toBe('a-1');
    expect(out[0]!.context.stale_threshold_hours).toBe(ACCOUNT_STALE_THRESHOLD_HOURS);
  });

  it('emits warn when last_synced_at is null', () => {
    const out = detectAccountStale({
      householdId: HOUSEHOLD,
      accounts: [acct({ last_synced_at: null })],
      now,
    });
    expect(out).toHaveLength(1);
  });

  it('ignores accounts from other households', () => {
    const out = detectAccountStale({
      householdId: HOUSEHOLD,
      accounts: [acct({ household_id: 'other', last_synced_at: '2026-04-20T00:00:00Z' })],
      now,
    });
    expect(out).toHaveLength(0);
  });
});
