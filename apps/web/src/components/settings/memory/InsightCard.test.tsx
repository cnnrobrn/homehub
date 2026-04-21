/**
 * @vitest-environment jsdom
 *
 * Light coverage for `<InsightCard>`:
 *   - Renders the stripped body without the footnote.
 *   - Renders the "Show citations" disclosure when a footnote is present.
 *   - Omits the disclosure when no footnote exists.
 *   - Marks the "Looks right" button as already-confirmed when the caller
 *     has confirmed it before.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/actions/memory', () => ({
  confirmInsightAction: vi.fn(async () => ({ ok: true, data: { insightId: 'i' } })),
  dismissInsightAction: vi.fn(async () => ({ ok: true, data: { insightId: 'i' } })),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock('@/components/ui/use-toast', () => ({
  toast: () => {},
}));

import { InsightCard } from './InsightCard';

function baseInsight(overrides: Partial<Parameters<typeof InsightCard>[0]['insight']> = {}) {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    weekStart: '2026-04-14',
    bodyMd:
      'You cooked four times this week.\n\n' +
      '<!-- homehub:reflection {"citations":[{"fact_id":"f1"}]} -->',
    createdAt: '2026-04-21T00:00:00Z',
    promotedToRuleId: null,
    confirmedByMemberIds: [],
    dismissedByMemberIds: [],
    ...overrides,
  };
}

describe('InsightCard', () => {
  it('renders the stripped body and the citations disclosure', () => {
    render(<InsightCard insight={baseInsight()} currentMemberId="me" />);
    expect(screen.getByText(/you cooked four times/i)).toBeInTheDocument();
    expect(screen.queryByText(/homehub:reflection/i)).not.toBeInTheDocument();
    expect(screen.getByText(/show citations/i)).toBeInTheDocument();
  });

  it('omits the citations disclosure when there is no footnote', () => {
    render(
      <InsightCard insight={baseInsight({ bodyMd: 'No footnote here.' })} currentMemberId="me" />,
    );
    expect(screen.queryByText(/show citations/i)).not.toBeInTheDocument();
  });

  it('marks the looks-right button as confirmed when the caller already confirmed', () => {
    render(
      <InsightCard insight={baseInsight({ confirmedByMemberIds: ['me'] })} currentMemberId="me" />,
    );
    expect(screen.getByRole('button', { name: /looks right/i })).toBeDisabled();
  });

  it('renders the Week-of label', () => {
    render(<InsightCard insight={baseInsight()} currentMemberId="me" />);
    expect(screen.getByText(/week of/i)).toBeInTheDocument();
  });
});
