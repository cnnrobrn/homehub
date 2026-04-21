/**
 * @vitest-environment jsdom
 *
 * Tests for the `<MemoryPauseToggle>` client island.
 *
 * Focus:
 *   - Renders the correct initial label based on `initialPaused`.
 *   - Calls `toggleMemoryWritesAction` with the new value on flip.
 *   - Reverts on action failure (no runaway optimistic state).
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toggleMock = vi.hoisted(() => vi.fn());

vi.mock('@/app/actions/memory', () => ({
  toggleMemoryWritesAction: toggleMock,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock('@/components/ui/use-toast', () => ({
  toast: () => {},
}));

import { MemoryPauseToggle } from './MemoryPauseToggle';

beforeEach(() => {
  toggleMock.mockReset();
  toggleMock.mockResolvedValue({
    ok: true,
    data: { paused: true, pausedAt: null, pausedByMemberId: null },
  });
});

describe('MemoryPauseToggle', () => {
  it('renders the active label when not paused', () => {
    render(<MemoryPauseToggle initialPaused={false} />);
    expect(screen.getByLabelText(/pause memory writes/i)).toBeInTheDocument();
    expect(screen.getByText(/active/i)).toBeInTheDocument();
  });

  it('calls toggleMemoryWritesAction on flip', async () => {
    const user = userEvent.setup();
    render(<MemoryPauseToggle initialPaused={false} />);
    await user.click(screen.getByLabelText(/pause memory writes/i));
    await waitFor(() => {
      expect(toggleMock).toHaveBeenCalledWith({ paused: true });
    });
  });

  it('reverts label when the server action fails', async () => {
    toggleMock.mockResolvedValue({ ok: false, error: { code: 'INTERNAL', message: 'boom' } });
    const user = userEvent.setup();
    render(<MemoryPauseToggle initialPaused={false} />);
    await user.click(screen.getByLabelText(/pause memory writes/i));
    await waitFor(() => {
      expect(screen.getByText(/active/i)).toBeInTheDocument();
    });
  });
});
