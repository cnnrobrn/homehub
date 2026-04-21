import { type HouseholdId } from '@homehub/shared';
import { describe, expect, it } from 'vitest';

import { __resetBudgetGuardForTests, withBudgetGuard } from './guard.js';

describe('withBudgetGuard', () => {
  it('returns { ok: true, tier: "default" } until model_calls lands', async () => {
    __resetBudgetGuardForTests();
    const fakeSupabase = {} as unknown as Parameters<typeof withBudgetGuard>[0];
    const result = await withBudgetGuard(fakeSupabase, {
      household_id: '11111111-1111-4111-8111-111111111111' as HouseholdId,
      task_class: 'enrichment.event',
    });
    expect(result).toEqual({ ok: true, tier: 'default' });
  });

  it('warns exactly once across repeat calls', async () => {
    __resetBudgetGuardForTests();
    const fakeSupabase = {} as unknown as Parameters<typeof withBudgetGuard>[0];
    const warns: unknown[] = [];
    const logger = {
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: (msg: string) => warns.push(msg),
      error: () => {},
      fatal: () => {},
      child: () => logger,
    };
    await withBudgetGuard(
      fakeSupabase,
      {
        household_id: '11111111-1111-4111-8111-111111111111' as HouseholdId,
        task_class: 'x',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      logger as any,
    );
    await withBudgetGuard(
      fakeSupabase,
      {
        household_id: '22222222-2222-4222-8222-222222222222' as HouseholdId,
        task_class: 'y',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      logger as any,
    );
    expect(warns.length).toBe(1);
  });
});
