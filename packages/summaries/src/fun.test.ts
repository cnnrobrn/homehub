/**
 * Unit tests for the fun summary renderer.
 */

import { type HouseholdId } from '@homehub/shared';
import { describe, expect, it } from 'vitest';

import { computeFunMetrics, renderFunSummary, type FunEventRow } from './fun.js';

const HOUSEHOLD_ID = 'h-1';
const HOUSEHOLD = HOUSEHOLD_ID as unknown as HouseholdId;

function ev(overrides: Partial<FunEventRow> = {}): FunEventRow {
  return {
    id: 'e-1',
    household_id: HOUSEHOLD_ID,
    segment: 'fun',
    kind: 'outing',
    title: 'Dinner',
    starts_at: '2026-04-18T19:00:00Z',
    ends_at: '2026-04-18T22:00:00Z',
    location: 'Maison',
    metadata: {},
    ...overrides,
  };
}

describe('computeFunMetrics', () => {
  it('computes counts + unique places + top kinds', () => {
    const metrics = computeFunMetrics({
      householdId: HOUSEHOLD,
      period: 'weekly',
      coveredStart: '2026-04-13T00:00:00Z',
      coveredEnd: '2026-04-20T00:00:00Z',
      events: [
        ev({ id: 'e-1', kind: 'outing', location: 'Maison' }),
        ev({ id: 'e-2', kind: 'outing', location: 'Maison' }),
        ev({ id: 'e-3', kind: 'concert', location: 'Park' }),
      ],
      upcomingEvents: [],
    });
    expect(metrics.eventCount).toBe(3);
    expect(metrics.uniquePlaces).toBe(2);
    expect(metrics.topKinds[0]).toEqual({ kind: 'outing', count: 2 });
    expect(metrics.totalHours).toBeGreaterThan(0);
  });

  it('includes trips in the trips array', () => {
    const metrics = computeFunMetrics({
      householdId: HOUSEHOLD,
      period: 'monthly',
      coveredStart: '2026-03-01T00:00:00Z',
      coveredEnd: '2026-04-01T00:00:00Z',
      events: [ev({ id: 't-1', kind: 'trip', title: 'Montreal' })],
      upcomingEvents: [],
    });
    expect(metrics.trips).toEqual([
      { id: 't-1', title: 'Montreal', startsAt: '2026-04-18T19:00:00Z' },
    ]);
  });

  it('filters out non-fun events + other households', () => {
    const metrics = computeFunMetrics({
      householdId: HOUSEHOLD,
      period: 'weekly',
      coveredStart: '2026-04-13T00:00:00Z',
      coveredEnd: '2026-04-20T00:00:00Z',
      events: [
        ev({ id: 'e-1' }),
        ev({ id: 'e-2', segment: 'financial' }),
        ev({ id: 'e-3', household_id: 'other' }),
      ],
      upcomingEvents: [],
    });
    expect(metrics.eventCount).toBe(1);
  });
});

describe('renderFunSummary', () => {
  it('renders a markdown body with sections', () => {
    const { bodyMd } = renderFunSummary({
      householdId: HOUSEHOLD,
      period: 'weekly',
      coveredStart: '2026-04-13T00:00:00Z',
      coveredEnd: '2026-04-20T00:00:00Z',
      events: [
        ev({ id: 'e-1', kind: 'outing' }),
        ev({ id: 'e-2', kind: 'outing' }),
        ev({ id: 'e-3', kind: 'trip', title: 'Montreal' }),
      ],
      upcomingEvents: [ev({ id: 'u-1' })],
    });
    expect(bodyMd).toContain('### Weekly fun recap');
    expect(bodyMd).toContain('**Events:** 3');
    expect(bodyMd).toContain('**Trips:**');
    expect(bodyMd).toContain('Montreal');
    expect(bodyMd).toContain('**Coming up:** 1');
  });

  it('renders a "no activity" body when empty', () => {
    const { bodyMd } = renderFunSummary({
      householdId: HOUSEHOLD,
      period: 'monthly',
      coveredStart: '2026-03-01T00:00:00Z',
      coveredEnd: '2026-04-01T00:00:00Z',
      events: [],
      upcomingEvents: [],
    });
    expect(bodyMd).toContain('No fun events in this period.');
  });
});
