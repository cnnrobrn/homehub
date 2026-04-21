/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPush, mockPathname, mockSearchParams } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockPathname: vi.fn(() => '/calendar'),
  mockSearchParams: vi.fn(() => new URLSearchParams('cursor=2026-04-20')),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
  usePathname: mockPathname,
  useSearchParams: mockSearchParams,
}));

import { ViewToggle } from './ViewToggle';

beforeEach(() => {
  mockPush.mockReset();
  mockPathname.mockImplementation(() => '/calendar');
  mockSearchParams.mockImplementation(() => new URLSearchParams('cursor=2026-04-20'));
});

describe('ViewToggle', () => {
  it('renders both view options with the current one checked', () => {
    render(<ViewToggle current="week" />);
    const week = screen.getByRole('radio', { name: /week/i });
    const month = screen.getByRole('radio', { name: /month/i });
    expect(week).toHaveAttribute('aria-checked', 'true');
    expect(month).toHaveAttribute('aria-checked', 'false');
  });

  it('pushes the new view to the URL while preserving other params', () => {
    render(<ViewToggle current="week" />);
    fireEvent.click(screen.getByRole('radio', { name: /month/i }));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0]?.[0]).toBe('/calendar?cursor=2026-04-20&view=month');
  });

  it('does not push when clicking the already-current view', () => {
    render(<ViewToggle current="week" />);
    fireEvent.click(screen.getByRole('radio', { name: /week/i }));
    expect(mockPush).not.toHaveBeenCalled();
  });
});
