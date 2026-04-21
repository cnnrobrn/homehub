/**
 * @vitest-environment jsdom
 *
 * Snapshot-style coverage for `EventPill` — ensures the segment palette
 * wiring is applied (border class per segment) and the accessible
 * description is rendered. Kept lightweight; snapshot files are not
 * checked in separately (inline via assertions).
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EventPill } from './EventPill';

import type { CalendarEventRow } from '@/lib/events/listEvents';

const SEGMENTS = ['financial', 'food', 'fun', 'social', 'system'] as const;

function baseEvent(overrides: Partial<CalendarEventRow> = {}): CalendarEventRow {
  return {
    id: 'e1',
    householdId: 'h1',
    segment: 'food',
    kind: 'gcal_event',
    title: 'Dinner',
    startsAt: '2026-04-21T18:00:00.000Z',
    endsAt: '2026-04-21T19:00:00.000Z',
    allDay: false,
    location: 'Home',
    provider: 'gcal',
    ownerMemberId: null,
    metadata: {},
    ...overrides,
  };
}

describe('EventPill', () => {
  it.each(SEGMENTS)('renders a %s pill with the segment border token', (segment) => {
    render(<EventPill event={baseEvent({ id: `e-${segment}`, segment })} />);
    const pill = screen.getByTestId(`event-pill-${segment}`);
    expect(pill).toBeInTheDocument();
    expect(pill.className).toContain(`border-l-[var(--segment-${segment})]`);
  });

  it('announces segment, title, and time for screen readers', () => {
    render(<EventPill event={baseEvent({ segment: 'food', title: 'Dinner' })} />);
    expect(screen.getByText(/Food: Dinner at/i)).toBeInTheDocument();
  });

  it('renders "All day" when the event is all-day', () => {
    render(<EventPill event={baseEvent({ allDay: true, location: null })} />);
    expect(screen.getByText('All day', { selector: 'span' })).toBeInTheDocument();
  });
});
