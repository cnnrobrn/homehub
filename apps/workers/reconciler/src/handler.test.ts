/**
 * Unit tests for the reconciler handler.
 *
 * Strategy: stub Supabase around an in-memory row set. Pins:
 *   - Merchant similarity (normalization + Jaro-Winkler).
 *   - Candidate filter (amount + date tolerance).
 *   - Exactly-one match → link both sides.
 *   - Multiple matches → mark ambiguous.
 *   - Zero candidates → no-op.
 *   - Idempotency: a second pass over the same data doesn't re-link.
 */

import { type Logger } from '@homehub/worker-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EMAIL_RECEIPT_SOURCE,
  PROVIDER_SOURCES,
  __internal,
  isCandidate,
  merchantSimilarity,
  runFinancialReconciler,
} from './handler.js';

function makeLog(): Logger {
  const noop = () => {};
  const base = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => base,
  } as Logger;
  return base;
}

interface Row {
  id: string;
  household_id: string;
  member_id?: string | null;
  occurred_at: string;
  amount_cents: number;
  merchant_raw: string | null;
  source: string;
  metadata: Record<string, unknown>;
}

function makeSupabase(initial: Row[]) {
  // Simple in-memory store keyed by transaction id. Updates mutate the
  // row in place so the test can read the outcome after the reconciler
  // returns.
  const rows = new Map<string, Row>();
  for (const r of initial) rows.set(r.id, { ...r, metadata: { ...r.metadata } });
  const audits: Array<Record<string, unknown>> = [];

  const schemaApp = {
    from(table: string): unknown {
      if (table !== 'transaction') throw new Error(`unexpected app.${table}`);
      const filters: Record<string, unknown> = {};
      let inFilter: { col: string; values: unknown[] } | undefined;
      const geConds: Array<{ col: string; value: string }> = [];
      let pendingUpdate: Partial<Row> | undefined;
      let mode: 'select' | 'update' = 'select';
      const selection: { cols?: string; limit?: number } = {};
      const builder = {
        select(cols?: string) {
          mode = 'select';
          if (cols !== undefined) selection.cols = cols;
          return builder;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return builder;
        },
        in(col: string, values: unknown[]) {
          inFilter = { col, values };
          return builder;
        },
        gte(col: string, val: string) {
          geConds.push({ col, value: val });
          return builder;
        },
        limit(n: number) {
          selection.limit = n;
          return builder;
        },
        update(payload: Partial<Row>) {
          mode = 'update';
          pendingUpdate = payload;
          return builder;
        },
        then(resolve: (v: unknown) => void) {
          if (mode === 'select') {
            let out = [...rows.values()];
            for (const [k, v] of Object.entries(filters)) {
              out = out.filter((r) => (r as unknown as Record<string, unknown>)[k] === v);
            }
            if (inFilter) {
              out = out.filter((r) =>
                inFilter!.values.includes((r as unknown as Record<string, unknown>)[inFilter!.col]),
              );
            }
            for (const cond of geConds) {
              out = out.filter(
                (r) => String((r as unknown as Record<string, unknown>)[cond.col]) >= cond.value,
              );
            }
            if (selection.limit != null) out = out.slice(0, selection.limit);
            resolve({ data: out, error: null });
            return undefined;
          }
          // update
          const id = filters.id;
          if (typeof id === 'string' && rows.has(id) && pendingUpdate) {
            const existing = rows.get(id)!;
            rows.set(id, { ...existing, ...pendingUpdate } as Row);
          }
          resolve({ data: null, error: null });
          return undefined;
        },
      };
      return builder;
    },
  };
  const schemaAudit = {
    from(table: string): unknown {
      if (table !== 'event') throw new Error(`unexpected audit.${table}`);
      return {
        insert: async (row: Record<string, unknown>) => {
          audits.push(row);
          return { data: null, error: null };
        },
      };
    },
  };
  const supabase = {
    schema(name: string) {
      if (name === 'app') return schemaApp;
      if (name === 'audit') return schemaAudit;
      throw new Error(`unexpected schema ${name}`);
    },
  };
  return { supabase, rows, audits };
}

const HOUSEHOLD_ID = 'h0000000-0000-4000-8000-000000000001';

beforeEach(() => {
  vi.clearAllMocks();
});

// --- merchant similarity ------------------------------------------------

describe('merchantSimilarity', () => {
  it('matches identical normalized strings as 1', () => {
    expect(merchantSimilarity('Blue Bottle', 'blue bottle')).toBe(1);
    expect(merchantSimilarity('BLUE BOTTLE!', 'blue bottle')).toBe(1);
  });
  it('rates near-identical with trailing location suffix high', () => {
    // The exact Jaro-Winkler value is not important, just that it's
    // above the auto-match threshold used by the reconciler.
    expect(merchantSimilarity('Blue Bottle Coffee #123', 'BLUE BOTTLE COFFEE')).toBeGreaterThan(
      0.8,
    );
  });
  it('rates distinct merchants below the threshold', () => {
    expect(merchantSimilarity('Starbucks', 'Philz Coffee')).toBeLessThan(0.8);
  });
  it('returns 0 when either side is null or empty', () => {
    expect(merchantSimilarity(null, 'a')).toBe(0);
    expect(merchantSimilarity('a', null)).toBe(0);
    expect(merchantSimilarity('', 'a')).toBe(0);
  });
});

// --- isCandidate --------------------------------------------------------

describe('isCandidate', () => {
  const email = {
    id: 'e1',
    household_id: 'h1',
    member_id: null,
    occurred_at: '2026-04-20T10:00:00.000Z',
    amount_cents: -1234,
    merchant_raw: 'Blue Bottle',
    metadata: {},
  };
  it('accepts within ±$1 and ±3 days', () => {
    expect(
      isCandidate(email, {
        id: 'p1',
        household_id: 'h1',
        occurred_at: '2026-04-21T09:00:00.000Z',
        amount_cents: -1300,
        merchant_raw: 'Blue Bottle Coffee',
        source: 'ynab',
        metadata: {},
      }),
    ).toBe(true);
  });
  it('rejects amount out-of-tolerance', () => {
    expect(
      isCandidate(email, {
        id: 'p1',
        household_id: 'h1',
        occurred_at: '2026-04-20T10:00:00.000Z',
        amount_cents: -1400,
        merchant_raw: 'Blue Bottle',
        source: 'ynab',
        metadata: {},
      }),
    ).toBe(false);
  });
  it('rejects date out-of-window', () => {
    expect(
      isCandidate(email, {
        id: 'p1',
        household_id: 'h1',
        occurred_at: '2026-04-25T10:00:00.000Z',
        amount_cents: -1234,
        merchant_raw: 'Blue Bottle',
        source: 'ynab',
        metadata: {},
      }),
    ).toBe(false);
  });
  it('rejects cross-household matches', () => {
    expect(
      isCandidate(email, {
        id: 'p1',
        household_id: 'h2',
        occurred_at: '2026-04-20T10:00:00.000Z',
        amount_cents: -1234,
        merchant_raw: 'Blue Bottle',
        source: 'ynab',
        metadata: {},
      }),
    ).toBe(false);
  });
});

// --- exactly-one match --------------------------------------------------

describe('runFinancialReconciler — exactly-one match', () => {
  it('links email + provider rows with cross-references and marks shadowed', async () => {
    const email: Row = {
      id: 'email-1',
      household_id: HOUSEHOLD_ID,
      member_id: null,
      occurred_at: '2026-04-20T10:00:00.000Z',
      amount_cents: -1234,
      merchant_raw: 'Blue Bottle',
      source: EMAIL_RECEIPT_SOURCE,
      metadata: {},
    };
    const provider: Row = {
      id: 'ynab-1',
      household_id: HOUSEHOLD_ID,
      occurred_at: '2026-04-21T09:00:00.000Z',
      amount_cents: -1300,
      merchant_raw: 'Blue Bottle Coffee #123',
      source: 'ynab',
      metadata: {},
    };
    const { supabase, rows, audits } = makeSupabase([email, provider]);
    const summaries = await runFinancialReconciler({
      supabase: supabase as never,
      log: makeLog(),
      householdIds: [HOUSEHOLD_ID],
      now: () => new Date('2026-04-22T00:00:00.000Z'),
    });
    expect(summaries[0]).toMatchObject({ matchesLinked: 1, ambiguousLeft: 0 });
    expect(rows.get('email-1')?.metadata).toMatchObject({
      matched_transaction_id: 'ynab-1',
      status: 'shadowed',
    });
    expect(rows.get('ynab-1')?.metadata).toMatchObject({ email_receipt_id: 'email-1' });
    expect(audits[0]).toMatchObject({ action: 'financial.reconciliation.completed' });
  });
});

// --- multiple matches --------------------------------------------------

describe('runFinancialReconciler — ambiguous', () => {
  it('marks ambiguous and leaves both provider rows untouched', async () => {
    const email: Row = {
      id: 'email-1',
      household_id: HOUSEHOLD_ID,
      member_id: null,
      occurred_at: '2026-04-20T10:00:00.000Z',
      amount_cents: -1200,
      merchant_raw: 'Blue Bottle',
      source: EMAIL_RECEIPT_SOURCE,
      metadata: {},
    };
    const p1: Row = {
      id: 'ynab-1',
      household_id: HOUSEHOLD_ID,
      occurred_at: '2026-04-20T11:00:00.000Z',
      amount_cents: -1250,
      merchant_raw: 'Blue Bottle Coffee',
      source: 'ynab',
      metadata: {},
    };
    const p2: Row = {
      id: 'ynab-2',
      household_id: HOUSEHOLD_ID,
      occurred_at: '2026-04-21T12:00:00.000Z',
      amount_cents: -1210,
      merchant_raw: 'Blue Bottle',
      source: 'ynab',
      metadata: {},
    };
    const { supabase, rows } = makeSupabase([email, p1, p2]);
    const summaries = await runFinancialReconciler({
      supabase: supabase as never,
      log: makeLog(),
      householdIds: [HOUSEHOLD_ID],
      now: () => new Date('2026-04-22T00:00:00.000Z'),
    });
    expect(summaries[0]).toMatchObject({ matchesLinked: 0, ambiguousLeft: 1 });
    expect(rows.get('email-1')?.metadata).toMatchObject({ status: 'ambiguous_match' });
    expect(rows.get('ynab-1')?.metadata).toEqual({});
    expect(rows.get('ynab-2')?.metadata).toEqual({});
  });
});

// --- no candidates -----------------------------------------------------

describe('runFinancialReconciler — no match', () => {
  it('leaves the email row untouched when there are no candidates', async () => {
    const email: Row = {
      id: 'email-1',
      household_id: HOUSEHOLD_ID,
      occurred_at: '2026-04-20T10:00:00.000Z',
      amount_cents: -1200,
      merchant_raw: 'Blue Bottle',
      source: EMAIL_RECEIPT_SOURCE,
      metadata: {},
    };
    const { supabase, rows } = makeSupabase([email]);
    const summaries = await runFinancialReconciler({
      supabase: supabase as never,
      log: makeLog(),
      householdIds: [HOUSEHOLD_ID],
      now: () => new Date('2026-04-22T00:00:00.000Z'),
    });
    expect(summaries[0]).toMatchObject({ unmatchedLeft: 1 });
    expect(rows.get('email-1')?.metadata).toEqual({});
  });
});

// --- idempotency -------------------------------------------------------

describe('runFinancialReconciler — idempotency', () => {
  it('does not re-link rows that already carry matched_transaction_id', async () => {
    const email: Row = {
      id: 'email-1',
      household_id: HOUSEHOLD_ID,
      occurred_at: '2026-04-20T10:00:00.000Z',
      amount_cents: -1200,
      merchant_raw: 'Blue Bottle',
      source: EMAIL_RECEIPT_SOURCE,
      metadata: { matched_transaction_id: 'ynab-1', status: 'shadowed' },
    };
    const provider: Row = {
      id: 'ynab-1',
      household_id: HOUSEHOLD_ID,
      occurred_at: '2026-04-20T11:00:00.000Z',
      amount_cents: -1250,
      merchant_raw: 'Blue Bottle',
      source: 'ynab',
      metadata: { email_receipt_id: 'email-1' },
    };
    const { supabase } = makeSupabase([email, provider]);
    const summaries = await runFinancialReconciler({
      supabase: supabase as never,
      log: makeLog(),
      householdIds: [HOUSEHOLD_ID],
      now: () => new Date('2026-04-22T00:00:00.000Z'),
    });
    // No fresh matches — already-linked rows are excluded.
    expect(summaries[0]).toMatchObject({ emailTxConsidered: 0, matchesLinked: 0 });
  });
});

// --- constants --------------------------------------------------------

describe('constants', () => {
  it('advertises the canonical provider source set', () => {
    expect([...PROVIDER_SOURCES]).toEqual(['ynab', 'monarch', 'plaid']);
  });
  it('normalizes merchant strings consistently', () => {
    expect(__internal.normalizeMerchant('Blue Bottle Coffee #123')).toBe('blue bottle coffee 123');
  });
});
