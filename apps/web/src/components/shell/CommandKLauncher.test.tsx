/**
 * @vitest-environment jsdom
 *
 * Keyboard shortcut + accessibility smoke for the ⌘K launcher. The
 * full chat flow needs the SSE route, so we only cover the
 * shortcut-to-open behaviour here; the streaming path has its own
 * route-handler test.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Next's router is needed by the component; stub it.
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

// The chat server action is called when opening — stub it.
vi.mock('@/app/actions/chat', () => ({
  createConversationAction: vi.fn(async () => ({ ok: true, data: { conversationId: 'c-1' } })),
}));

import { CommandKLauncher } from './CommandKLauncher';

describe('CommandKLauncher', () => {
  it('renders a labeled trigger', () => {
    render(<CommandKLauncher householdId="hh-1" />);
    expect(screen.getByRole('button', { name: /command launcher/i })).toBeInTheDocument();
  });

  it('opens the dialog on ⌘K', () => {
    render(<CommandKLauncher householdId="hh-1" />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.getByText(/Ask HomeHub/i)).toBeInTheDocument();
  });

  it('opens the dialog on Ctrl+K', () => {
    render(<CommandKLauncher householdId="hh-1" />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByText(/Ask HomeHub/i)).toBeInTheDocument();
  });
});
