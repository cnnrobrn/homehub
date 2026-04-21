/**
 * @vitest-environment jsdom
 *
 * Tests for the SuggestionApprovalPill client island.
 *
 * - Pending status renders Approve + Reject buttons.
 * - Approved status renders a status pill (no buttons).
 * - Clicking Approve dispatches the suggestions action.
 * - Quorum > 1 renders the "M of N approvers" pip.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const approveMock = vi.hoisted(() => vi.fn());
const rejectMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());

vi.mock('@/app/actions/suggestions', () => ({
  approveSuggestionViaQueueAction: approveMock,
  rejectSuggestionViaQueueAction: rejectMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, push: () => {} }),
}));

vi.mock('@/components/ui/use-toast', () => ({
  toast: () => {},
}));

import { SuggestionApprovalPill } from './SuggestionApprovalPill';

beforeEach(() => {
  approveMock.mockReset();
  rejectMock.mockReset();
  refreshMock.mockReset();
});

describe('SuggestionApprovalPill', () => {
  it('renders Approve and Reject buttons when pending', () => {
    render(
      <SuggestionApprovalPill
        suggestionId="s1"
        status="pending"
        requiresQuorum={1}
        approvers={[]}
      />,
    );
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
  });

  it('renders a status pill without buttons when resolved', () => {
    render(
      <SuggestionApprovalPill
        suggestionId="s1"
        status="approved"
        requiresQuorum={1}
        approvers={[{ memberId: 'm1', memberName: 'Alex', approvedAt: '2026-04-20T12:00:00Z' }]}
      />,
    );
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument();
    // Status pill shows the plain status text.
    expect(screen.getAllByText('approved')[0]).toBeInTheDocument();
  });

  it('calls approve action on Approve click', async () => {
    const user = userEvent.setup();
    approveMock.mockResolvedValue({
      ok: true,
      data: {
        suggestionId: 's1',
        status: 'approved',
        approvers: [],
        quorumMet: true,
        eligibleToExecute: true,
      },
    });
    render(
      <SuggestionApprovalPill
        suggestionId="s1"
        status="pending"
        requiresQuorum={1}
        approvers={[]}
      />,
    );
    await user.click(screen.getByRole('button', { name: /approve/i }));
    expect(approveMock).toHaveBeenCalledWith({ suggestionId: 's1' });
  });

  it('shows quorum pip when requiresQuorum > 1', () => {
    render(
      <SuggestionApprovalPill
        suggestionId="s1"
        status="pending"
        requiresQuorum={2}
        approvers={[{ memberId: 'm1', memberName: 'Alex', approvedAt: '2026-04-20T12:00:00Z' }]}
      />,
    );
    expect(screen.getByText(/1 of 2 approvers/i)).toBeInTheDocument();
  });
});
