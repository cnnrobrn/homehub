/**
 * @vitest-environment jsdom
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { computeHypeFill, HypeBar, HYPE_WINDOW_DAYS } from './HypeBar';

const NOW = new Date('2026-05-06T12:00:00Z');
const MS_PER_DAY = 86_400_000;

function isoDaysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * MS_PER_DAY).toISOString();
}

describe('computeHypeFill', () => {
  it('is 0% when the target is outside the 30-day window', () => {
    const result = computeHypeFill(isoDaysFromNow(60), NOW);
    expect(result.percent).toBe(0);
    expect(result.daysRemaining).toBe(60);
  });

  it('is 100% on the target day', () => {
    const result = computeHypeFill(isoDaysFromNow(0), NOW);
    expect(result.percent).toBe(100);
  });

  it('is ~50% halfway through the window', () => {
    const result = computeHypeFill(isoDaysFromNow(Math.floor(HYPE_WINDOW_DAYS / 2)), NOW);
    expect(result.percent).toBeGreaterThan(40);
    expect(result.percent).toBeLessThan(60);
  });

  it('treats past dates as fully hyped', () => {
    const result = computeHypeFill(isoDaysFromNow(-3), NOW);
    expect(result.percent).toBe(100);
    expect(result.daysRemaining).toBeLessThan(0);
  });

  it('returns 0 percent for an invalid date string', () => {
    const result = computeHypeFill('not-a-date', NOW);
    expect(result.percent).toBe(0);
  });
});

describe('<HypeBar />', () => {
  it('renders an accessible label with days remaining', () => {
    const { container } = render(<HypeBar targetDate={isoDaysFromNow(5)} now={NOW} />);
    expect(container.querySelector('[aria-label^="Hype:"]')).toBeTruthy();
  });

  it('shows "Today" on the day-of', () => {
    const { getByText } = render(<HypeBar targetDate={isoDaysFromNow(0)} now={NOW} />);
    expect(getByText('Today')).toBeDefined();
  });
});
