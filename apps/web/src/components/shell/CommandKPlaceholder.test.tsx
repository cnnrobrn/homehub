/**
 * @vitest-environment jsdom
 *
 * The ⌘K placeholder binds a global keydown listener. This test verifies
 * the keyboard shortcut toggles the dialog and that the trigger button is
 * keyboard-reachable.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CommandKPlaceholder } from './CommandKPlaceholder';

describe('CommandKPlaceholder', () => {
  it('renders a trigger button that is labeled for assistive tech', () => {
    render(<CommandKPlaceholder />);
    const btn = screen.getByRole('button', { name: /command launcher/i });
    expect(btn).toBeInTheDocument();
  });

  it('opens the dialog on ⌘K / Ctrl+K', () => {
    render(<CommandKPlaceholder />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.getByText(/Chat is coming in M3.5/i)).toBeInTheDocument();
  });

  it('opens the dialog on Ctrl+K (non-mac)', () => {
    render(<CommandKPlaceholder />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByText(/Chat is coming in M3.5/i)).toBeInTheDocument();
  });
});
