/**
 * Unit tests for the model-usage rollup logic.
 *
 * Tests focus on the pure aggregation (`rollupModelCalls`) — it is
 * deterministic and cheap to exercise. The Supabase integration path is
 * covered indirectly by the ops page render.
 */

import { describe, expect, it } from 'vitest';

import { rollupModelCalls, type ModelCallRow } from './modelUsageRollup';

function row(
  partial: Partial<ModelCallRow> & { at: string; task: string; model: string },
): ModelCallRow {
  return {
    task: partial.task,
    model: partial.model,
    input_tokens: partial.input_tokens ?? 0,
    output_tokens: partial.output_tokens ?? 0,
    cost_usd: partial.cost_usd ?? 0,
    latency_ms: partial.latency_ms ?? null,
    at: partial.at,
  };
}

describe('rollupModelCalls', () => {
  const monthStart = new Date('2026-04-01T00:00:00Z');

  it('computes MTD cost + budget percentage', () => {
    const rows: ModelCallRow[] = [
      // In-month rows.
      row({
        at: '2026-04-03T00:00:00Z',
        task: 'enrichment.event',
        model: 'kimi-k2',
        cost_usd: 0.5,
      }),
      row({
        at: '2026-04-05T00:00:00Z',
        task: 'enrichment.event',
        model: 'kimi-k2',
        cost_usd: 0.25,
      }),
      // Out of the MTD window — still counted in the historical rollup.
      row({
        at: '2026-03-28T00:00:00Z',
        task: 'enrichment.event',
        model: 'kimi-k2',
        cost_usd: 9.0,
      }),
    ];
    const report = rollupModelCalls(rows, monthStart, 1.5);
    expect(report.totalCostUsdMtd).toBeCloseTo(0.75, 5);
    expect(report.totalCallsMtd).toBe(2);
    expect(report.monthUsedPct).toBeCloseTo(50, 1);
  });

  it('ranks the top 10 tasks by cost desc', () => {
    const rows: ModelCallRow[] = [];
    for (let i = 0; i < 15; i++) {
      rows.push(
        row({
          at: '2026-04-10T00:00:00Z',
          task: `task_${i}`,
          model: 'claude-sonnet-4.5',
          cost_usd: i * 0.1,
        }),
      );
    }
    const report = rollupModelCalls(rows, monthStart, null);
    expect(report.topTasks).toHaveLength(10);
    expect(report.topTasks[0]?.task).toBe('task_14');
    expect(report.topTasks[0]?.costUsd).toBeCloseTo(1.4, 5);
  });

  it('computes p50 / p95 latency per task', () => {
    const latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const rows = latencies.map((ms, i) =>
      row({
        at: `2026-04-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
        task: 'enrichment.event',
        model: 'kimi-k2',
        latency_ms: ms,
      }),
    );
    const report = rollupModelCalls(rows, monthStart, null);
    const t = report.topTasks.find((x) => x.task === 'enrichment.event');
    expect(t).toBeDefined();
    // nearest-rank p50 on 10 samples is index 4 (ceil(5) - 1) = 50.
    expect(t?.latencyP50Ms).toBe(50);
    // p95 on 10 samples is index 9 → 100.
    expect(t?.latencyP95Ms).toBe(100);
  });

  it('returns null budget percentage when no budget is configured', () => {
    const rows: ModelCallRow[] = [
      row({ at: '2026-04-01T00:00:00Z', task: 't', model: 'm', cost_usd: 1 }),
    ];
    const report = rollupModelCalls(rows, monthStart, null);
    expect(report.monthBudgetUsd).toBeNull();
    expect(report.monthUsedPct).toBeNull();
  });

  it('groups per day in UTC', () => {
    const rows: ModelCallRow[] = [
      row({ at: '2026-04-10T01:00:00Z', task: 't', model: 'm', cost_usd: 1 }),
      row({ at: '2026-04-10T23:00:00Z', task: 't', model: 'm', cost_usd: 2 }),
      row({ at: '2026-04-11T00:00:00Z', task: 't', model: 'm', cost_usd: 3 }),
    ];
    const report = rollupModelCalls(rows, monthStart, null);
    expect(report.byDay).toEqual([
      { day: '2026-04-10', costUsd: 3, calls: 2 },
      { day: '2026-04-11', costUsd: 3, calls: 1 },
    ]);
  });

  it('caps byModel by cost desc', () => {
    const rows: ModelCallRow[] = [
      row({ at: '2026-04-05T00:00:00Z', task: 't', model: 'kimi-k2', cost_usd: 1 }),
      row({ at: '2026-04-05T00:00:00Z', task: 't', model: 'claude', cost_usd: 10 }),
    ];
    const report = rollupModelCalls(rows, monthStart, null);
    expect(report.byModel[0]?.model).toBe('claude');
    expect(report.byModel[1]?.model).toBe('kimi-k2');
  });
});
