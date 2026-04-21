/**
 * Tests for `listFinancialAlerts`.
 *
 * Covers severity sort order and dismissed-filter default.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { listFinancialAlerts } from './listFinancialAlerts';

interface AlertRowFake {
  id: string;
  household_id: string;
  segment: string;
  severity: string;
  title: string;
  body: string;
  generated_at: string;
  generated_by: string;
  dismissed_at: string | null;
  dismissed_by: string | null;
  context: unknown;
}

function makeFakeClient(rows: AlertRowFake[] = []) {
  const calls: Array<{ op: string; value?: unknown; column?: string }> = [];
  const thenable: Record<string, unknown> = {
    select() {
      return thenable;
    },
    eq(column: string, value: unknown) {
      calls.push({ op: 'eq', column, value });
      return thenable;
    },
    is(column: string, value: unknown) {
      calls.push({ op: 'is', column, value });
      return thenable;
    },
    in(column: string, value: unknown) {
      calls.push({ op: 'in', column, value });
      return thenable;
    },
    order() {
      return thenable;
    },
    limit() {
      return thenable;
    },
    then(resolve: (v: { data: AlertRowFake[]; error: null }) => void) {
      resolve({ data: rows, error: null });
    },
  };
  return {
    client: {
      schema() {
        return {
          from() {
            return thenable;
          },
        };
      },
    },
    calls,
  };
}

const HOUSEHOLD = '11111111-1111-4111-8111-111111111111';

describe('listFinancialAlerts', () => {
  it('sorts critical before warn before info', async () => {
    const { client } = makeFakeClient([
      {
        id: 'a1',
        household_id: HOUSEHOLD,
        segment: 'financial',
        severity: 'warn',
        title: 'Warn',
        body: '',
        generated_at: '2026-04-20T10:00:00Z',
        generated_by: 'worker',
        dismissed_at: null,
        dismissed_by: null,
        context: {},
      },
      {
        id: 'a2',
        household_id: HOUSEHOLD,
        segment: 'financial',
        severity: 'critical',
        title: 'Critical',
        body: '',
        generated_at: '2026-04-19T10:00:00Z',
        generated_by: 'worker',
        dismissed_at: null,
        dismissed_by: null,
        context: {},
      },
      {
        id: 'a3',
        household_id: HOUSEHOLD,
        segment: 'financial',
        severity: 'info',
        title: 'Info',
        body: '',
        generated_at: '2026-04-21T10:00:00Z',
        generated_by: 'worker',
        dismissed_at: null,
        dismissed_by: null,
        context: {},
      },
    ]);
    const rows = await listFinancialAlerts(
      { householdId: HOUSEHOLD },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { client: client as any },
    );
    expect(rows.map((r) => r.severity)).toEqual(['critical', 'warn', 'info']);
  });

  it('filters by segment=financial and dismissed_at IS NULL by default', async () => {
    const { client, calls } = makeFakeClient([]);
    await listFinancialAlerts(
      { householdId: HOUSEHOLD },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { client: client as any },
    );
    expect(calls).toContainEqual({ op: 'eq', column: 'segment', value: 'financial' });
    expect(calls).toContainEqual({ op: 'is', column: 'dismissed_at', value: null });
  });

  it('surfaces alert_kind + alert_dedupe_key from context', async () => {
    const { client } = makeFakeClient([
      {
        id: 'a1',
        household_id: HOUSEHOLD,
        segment: 'financial',
        severity: 'critical',
        title: 'T',
        body: 'B',
        generated_at: '2026-04-20T10:00:00Z',
        generated_by: 'worker',
        dismissed_at: null,
        dismissed_by: null,
        context: {
          alert_kind: 'large_charge',
          alert_dedupe_key: 'charge:abc',
        },
      },
    ]);
    const rows = await listFinancialAlerts(
      { householdId: HOUSEHOLD },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { client: client as any },
    );
    expect(rows[0]?.alertKind).toBe('large_charge');
    expect(rows[0]?.alertDedupeKey).toBe('charge:abc');
  });
});
