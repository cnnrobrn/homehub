/**
 * Unit tests for `runHouseholdExport`.
 *
 * Uses a minimal in-memory stub for the Supabase client. The goal is
 * to prove that
 *   1. the happy path produces a manifest with the expected row counts,
 *   2. missing tables (read returns an error) are gracefully omitted,
 *   3. two runs over the same data yield byte-identical output.
 */

import { describe, expect, it } from 'vitest';

import { runHouseholdExport } from './handler.js';

type Table = Record<string, Record<string, unknown>[]>;

function stubSupabase(tables: Table) {
  function buildChain(name: string) {
    const listResponse = () =>
      tables[name] !== undefined
        ? { data: tables[name]!, error: null }
        : {
            data: null,
            error: { message: `relation ${name} does not exist`, code: 'PGRST204' },
          };
    const singleResponse = () => {
      const rows = tables[name] ?? [];
      return { data: rows[0] ?? null, error: null };
    };

    const chain = {
      eq(_col: string, _val: string) {
        return {
          ...chain,
          then(
            onFulfilled: (value: ReturnType<typeof listResponse>) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) {
            return Promise.resolve(listResponse()).then(onFulfilled, onRejected);
          },
          maybeSingle() {
            return Promise.resolve(singleResponse());
          },
        };
      },
      in(_col: string, _vals: string[]) {
        return Promise.resolve({ data: tables[name] ?? [], error: null });
      },
      maybeSingle() {
        return Promise.resolve(singleResponse());
      },
    };
    return chain;
  }

  return {
    schema(_schema: string) {
      return {
        from(name: string) {
          return {
            select(_cols: string) {
              return buildChain(name);
            },
          };
        },
      };
    },
  };
}

const stubLogger = {
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  child() {
    return stubLogger;
  },
};

describe('runHouseholdExport', () => {
  const HOUSEHOLD = '11111111-1111-4111-8111-111111111111';
  const now = new Date('2026-04-20T00:00:00Z');

  it('produces a manifest with the present-table row counts', async () => {
    const supabase = stubSupabase({
      household: [{ id: HOUSEHOLD, name: 'Test', settings: {}, created_at: '2026-01-01' }],
      member: [
        {
          id: 'm2',
          user_id: 'u2',
          role: 'adult',
          joined_at: '2026-01-02',
          household_id: HOUSEHOLD,
        },
        {
          id: 'm1',
          user_id: 'u1',
          role: 'owner',
          joined_at: '2026-01-01',
          household_id: HOUSEHOLD,
        },
      ],
      member_segment_grant: [
        { member_id: 'm1', segment: 'financial', access: 'write' },
        { member_id: 'm1', segment: 'food', access: 'write' },
      ],
      event: [
        { id: 'e2', household_id: HOUSEHOLD, title: 'b' },
        { id: 'e1', household_id: HOUSEHOLD, title: 'a' },
      ],
      // transaction is intentionally omitted — the stub reports it as
      // missing, and the manifest should skip it.
    });

    const result = await runHouseholdExport({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
      log: stubLogger,
      householdId: HOUSEHOLD,
      now,
    });

    expect(result.files['household.json']).toContain(HOUSEHOLD);
    expect(result.files['events.ndjson']).toContain('"id":"e1"');
    // Missing tables are omitted from rowCounts.
    expect(result.rowCounts['app.transaction']).toBeUndefined();
    // Row counts reflect present tables.
    expect(result.rowCounts['app.event']).toBe(2);
    // Manifest is in the files bundle.
    expect(result.files['manifest.json']).toContain(HOUSEHOLD);
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it('is deterministic across runs', async () => {
    const supabase = stubSupabase({
      household: [{ id: HOUSEHOLD, name: 'Test', settings: {}, created_at: '2026-01-01' }],
      member: [
        {
          id: 'm2',
          user_id: 'u2',
          role: 'adult',
          joined_at: '2026-01-02',
          household_id: HOUSEHOLD,
        },
        {
          id: 'm1',
          user_id: 'u1',
          role: 'owner',
          joined_at: '2026-01-01',
          household_id: HOUSEHOLD,
        },
      ],
      member_segment_grant: [],
      event: [
        { id: 'e2', household_id: HOUSEHOLD, title: 'b' },
        { id: 'e1', household_id: HOUSEHOLD, title: 'a' },
      ],
    });

    const first = await runHouseholdExport({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
      log: stubLogger,
      householdId: HOUSEHOLD,
      now,
    });
    const second = await runHouseholdExport({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
      log: stubLogger,
      householdId: HOUSEHOLD,
      now,
    });

    expect(first.manifest).toBe(second.manifest);
    expect(first.files['events.ndjson']).toBe(second.files['events.ndjson']);
    expect(first.files['household.json']).toBe(second.files['household.json']);
  });
});
