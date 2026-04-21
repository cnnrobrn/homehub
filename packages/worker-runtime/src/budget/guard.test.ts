import { type HouseholdId } from '@homehub/shared';
import { describe, expect, it } from 'vitest';

import { type ServiceSupabaseClient } from '../supabase/client.js';

import { withBudgetGuard } from './guard.js';

const HID = '11111111-1111-4111-8111-111111111111' as HouseholdId;

/**
 * Minimal fake: query builder answers `.select(...).eq(...).maybeSingle()`
 * and `.select(...).eq(...).gte(...)`. Enough surface to exercise the
 * two reads the guard performs.
 */
function fakeSupabase({
  settings,
  callsCostUsd = [],
  householdError,
  callsError,
}: {
  settings?: Record<string, unknown>;
  callsCostUsd?: number[];
  householdError?: { message: string };
  callsError?: { message: string };
}): ServiceSupabaseClient {
  type Query = {
    select: (cols?: string) => Query;
    eq: (col: string, val: unknown) => Query;
    gte: (col: string, val: unknown) => Query;
    maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
    then: <T>(cb: (r: { data: unknown; error: unknown }) => T) => Promise<T>;
  };

  const makeQuery = (table: 'household' | 'model_calls'): Query => {
    const q: Query = {
      select: () => q,
      eq: () => q,
      gte: () => q,
      maybeSingle: () =>
        table === 'household'
          ? Promise.resolve({
              data: settings !== undefined ? { settings } : null,
              error: householdError ?? null,
            })
          : Promise.reject(new Error('model_calls does not use maybeSingle here')),
      then: (cb) => {
        if (table === 'model_calls') {
          return Promise.resolve(
            cb({
              data: callsError ? null : callsCostUsd.map((c) => ({ cost_usd: c })),
              error: callsError ?? null,
            }),
          );
        }
        return Promise.resolve(
          cb({
            data: settings !== undefined ? { settings } : null,
            error: householdError ?? null,
          }),
        );
      },
    };
    return q;
  };

  return {
    schema(_s: string) {
      void _s;
      return {
        from(table: string) {
          if (table === 'household') return makeQuery('household');
          if (table === 'model_calls') return makeQuery('model_calls');
          throw new Error(`fakeSupabase: unknown table ${table}`);
        },
      };
    },
  } as unknown as ServiceSupabaseClient;
}

describe('withBudgetGuard', () => {
  it('returns { ok: true, tier: "default" } when no budget is set', async () => {
    const sb = fakeSupabase({ settings: {} });
    const res = await withBudgetGuard(sb, { household_id: HID, task_class: 'x' });
    expect(res).toEqual({ ok: true, tier: 'default' });
  });

  it('returns default tier when usage is below 80% of budget', async () => {
    // budget: 10000 cents = $100. usage: $70.
    const sb = fakeSupabase({
      settings: { model_budget_monthly_cents: 10000 },
      callsCostUsd: [30, 40],
    });
    const res = await withBudgetGuard(sb, { household_id: HID, task_class: 'x' });
    expect(res).toEqual({ ok: true, tier: 'default' });
  });

  it('returns degraded tier at or above 80% of budget', async () => {
    // budget: 10000 cents = $100. usage: $80.
    const sb = fakeSupabase({
      settings: { model_budget_monthly_cents: 10000 },
      callsCostUsd: [80],
    });
    const res = await withBudgetGuard(sb, { household_id: HID, task_class: 'x' });
    expect(res).toEqual({ ok: true, tier: 'degraded' });
  });

  it('returns budget_exceeded at or above 100% of budget', async () => {
    const sb = fakeSupabase({
      settings: { model_budget_monthly_cents: 10000 },
      callsCostUsd: [100],
    });
    const res = await withBudgetGuard(sb, { household_id: HID, task_class: 'x' });
    expect(res).toEqual({ ok: false, reason: 'budget_exceeded' });
  });

  it('fails open (default tier) when household read errors', async () => {
    const sb = fakeSupabase({ householdError: { message: 'boom' }, settings: {} });
    const res = await withBudgetGuard(sb, { household_id: HID, task_class: 'x' });
    expect(res).toEqual({ ok: true, tier: 'default' });
  });

  it('fails open (default tier) when model_calls read errors', async () => {
    const sb = fakeSupabase({
      settings: { model_budget_monthly_cents: 10000 },
      callsError: { message: 'boom' },
    });
    const res = await withBudgetGuard(sb, { household_id: HID, task_class: 'x' });
    expect(res).toEqual({ ok: true, tier: 'default' });
  });

  it('ignores non-numeric budget values (treated as unset)', async () => {
    const sb = fakeSupabase({
      settings: { model_budget_monthly_cents: 'lots' as unknown as number },
    });
    const res = await withBudgetGuard(sb, { household_id: HID, task_class: 'x' });
    expect(res).toEqual({ ok: true, tier: 'default' });
  });
});
