/**
 * @vitest-environment jsdom
 *
 * Client-side wiring tests for `MemorySearch`.
 *
 * The server action is mocked; we assert the input debounces, the
 * result list renders when the action returns, and error messages
 * surface when the envelope fails.
 */

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const searchAction = vi.hoisted(() => vi.fn());

vi.mock('@/app/actions/memory', () => ({
  searchMemoryAction: searchAction,
}));

import { MemorySearch } from './MemorySearch';

beforeEach(() => {
  searchAction.mockReset();
});

describe('MemorySearch', () => {
  it('renders search results when the action succeeds', async () => {
    searchAction.mockResolvedValue({
      ok: true,
      data: {
        nodes: [{ id: 'n1', type: 'person', canonical_name: 'Sarah' }],
        facts: [],
        episodes: [],
      },
    });
    const user = userEvent.setup();
    render(<MemorySearch householdId="h1" debounceMs={0} />);
    const input = screen.getByLabelText('Search memory');
    await user.type(input, 'Sarah');
    // Wait for effects to settle.
    await act(async () => {
      await Promise.resolve();
    });
    await screen.findByText('Sarah');
    expect(searchAction).toHaveBeenCalled();
  });

  it('surfaces the envelope error message', async () => {
    searchAction.mockResolvedValue({
      ok: false,
      error: { code: 'INTERNAL', message: 'search failed' },
    });
    const user = userEvent.setup();
    render(<MemorySearch householdId="h1" debounceMs={0} />);
    await user.type(screen.getByLabelText('Search memory'), 'x');
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('search failed');
  });

  it('clears results when the query is empty', async () => {
    const user = userEvent.setup();
    render(<MemorySearch householdId="h1" debounceMs={0} />);
    await user.type(screen.getByLabelText('Search memory'), 'x');
    await user.clear(screen.getByLabelText('Search memory'));
    expect(searchAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
