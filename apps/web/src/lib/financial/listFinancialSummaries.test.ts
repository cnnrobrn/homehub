/**
 * Tests for `listFinancialSummaries`.
 *
 * Covers grant gating and row mapping.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { listFinancialSummaries } from './listFinancialSummaries';

interface SummaryRowFake {
  id: string;
  household_id: string;
  segment: string;
  period: string;
  covered_start: string;
  covered_end: string;
  generated_at: string;
  model: string;
  body_md: string;
}

function makeFakeClient(rows: SummaryRowFake[] = []) {
  const thenable: Record<string, unknown> = {
    select() {
      return thenable;
    },
    eq() {
      return thenable;
    },
    order() {
      return thenable;
    },
    limit() {
      return thenable;
    },
    then(resolve: (v: { data: SummaryRowFake[]; error: null }) => void) {
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
  };
}

const HOUSEHOLD = '11111111-1111-4111-8111-111111111111';

describe('listFinancialSummaries', () => {
  it('maps snake_case rows to camelCase', async () => {
    const { client } = makeFakeClient([
      {
        id: 's1',
        household_id: HOUSEHOLD,
        segment: 'financial',
        period: 'week',
        covered_start: '2026-04-13T00:00:00Z',
        covered_end: '2026-04-19T23:59:59Z',
        generated_at: '2026-04-20T01:00:00Z',
        model: 'sonnet-4-7',
        body_md: '## Weekly\n- spent $120',
      },
    ]);
    const rows = await listFinancialSummaries(
      { householdId: HOUSEHOLD },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { client: client as any },
    );
    expect(rows[0]).toMatchObject({
      id: 's1',
      period: 'week',
      coveredStart: '2026-04-13T00:00:00Z',
      coveredEnd: '2026-04-19T23:59:59Z',
      bodyMd: '## Weekly\n- spent $120',
    });
  });

  it('returns empty when grant denies financial:read', async () => {
    const { client } = makeFakeClient([]);
    const rows = await listFinancialSummaries(
      { householdId: HOUSEHOLD },
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client: client as any,
        grants: [{ segment: 'financial', access: 'none' }],
      },
    );
    expect(rows).toEqual([]);
  });
});
