/**
 * @vitest-environment jsdom
 *
 * Snapshot tests for `<FinancialSummaryCard />`.
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FinancialSummaryCard } from './FinancialSummaryCard';

import type { FinancialSummaryRow } from '@/lib/financial';

const baseSummary: FinancialSummaryRow = {
  id: 's1',
  householdId: '11111111-1111-4111-8111-111111111111',
  segment: 'financial',
  period: 'week',
  coveredStart: '2026-04-13T00:00:00Z',
  coveredEnd: '2026-04-19T23:59:59Z',
  generatedAt: '2026-04-20T00:00:00Z',
  model: 'sonnet-4-7',
  bodyMd: '## Summary\n- Net: -$120\n- Top merchant: Whole Foods',
};

describe('<FinancialSummaryCard />', () => {
  it('renders minimal summary with weekly label', () => {
    const { getByText } = render(<FinancialSummaryCard summary={baseSummary} />);
    expect(getByText('Weekly summary')).toBeDefined();
    expect(getByText(/Net: -\$120/)).toBeDefined();
  });

  it('renders monthly label when period=month', () => {
    const rich = { ...baseSummary, period: 'month' };
    const { getByText } = render(<FinancialSummaryCard summary={rich} />);
    expect(getByText('Monthly summary')).toBeDefined();
  });
});
