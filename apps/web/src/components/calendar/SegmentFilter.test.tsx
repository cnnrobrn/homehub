/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPush, mockPathname, mockSearchParams } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockPathname: vi.fn(() => '/calendar'),
  mockSearchParams: vi.fn(() => new URLSearchParams('')),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
  usePathname: mockPathname,
  useSearchParams: mockSearchParams,
}));

import { SegmentFilter } from './SegmentFilter';

beforeEach(() => {
  mockPush.mockReset();
  mockPathname.mockImplementation(() => '/calendar');
  mockSearchParams.mockImplementation(() => new URLSearchParams(''));
});

describe('SegmentFilter', () => {
  it('renders a checkbox per available segment', () => {
    render(
      <SegmentFilter
        available={['financial', 'food', 'fun', 'social', 'system']}
        selected={['financial', 'food', 'fun', 'social', 'system']}
      />,
    );
    for (const label of ['Financial', 'Food', 'Fun', 'Social', 'System']) {
      expect(screen.getByLabelText(new RegExp(label, 'i'))).toBeInTheDocument();
    }
  });

  it('clears the segments param when all segments are selected', () => {
    mockSearchParams.mockImplementation(() => new URLSearchParams('segments=food'));
    render(<SegmentFilter available={['food', 'fun']} selected={['food']} />);
    // Click the Fun checkbox to select it — now both are selected, so
    // the param should be removed.
    fireEvent.click(screen.getByLabelText(/fun/i));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0]?.[0]).toBe('/calendar?');
  });

  it('writes a comma-separated list when partial', () => {
    render(
      <SegmentFilter
        available={['financial', 'food', 'fun']}
        selected={['financial', 'food', 'fun']}
      />,
    );
    // Uncheck Financial → selection becomes ['food', 'fun'].
    fireEvent.click(screen.getByLabelText(/financial/i));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0]?.[0]).toBe('/calendar?segments=food%2Cfun');
  });

  it('encodes "none" when everything is deselected', () => {
    render(<SegmentFilter available={['food']} selected={['food']} />);
    fireEvent.click(screen.getByLabelText(/food/i));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0]?.[0]).toBe('/calendar?segments=none');
  });
});
