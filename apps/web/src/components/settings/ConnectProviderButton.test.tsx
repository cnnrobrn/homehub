/**
 * @vitest-environment jsdom
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    refresh: vi.fn(),
    startConnectSessionAction: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock('@/app/actions/integrations', () => ({
  startConnectSessionAction: mocks.startConnectSessionAction,
}));

import { ConnectProviderButton } from './ConnectProviderButton';

describe('ConnectProviderButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('refreshes without reading popup.closed after opening Nango', async () => {
    const popup = {};
    Object.defineProperty(popup, 'closed', {
      get() {
        throw new Error('popup.closed should not be read');
      },
    });
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as Window);
    mocks.startConnectSessionAction.mockResolvedValue({
      ok: true,
      data: { connectUrl: 'https://connect.nango.test/session/session-token' },
    });

    render(
      <ConnectProviderButton provider="google-calendar">
        Connect Google Calendar
      </ConnectProviderButton>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Connect Google Calendar' }));
    await act(async () => {});

    expect(open).toHaveBeenCalledWith(
      'https://connect.nango.test/session/session-token',
      'homehub-nango-connect',
      expect.any(String),
    );
    expect(screen.getByRole('button')).toHaveTextContent('Checking connection');

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes when focus returns from the OAuth popup', async () => {
    vi.spyOn(window, 'open').mockReturnValue({} as Window);
    mocks.startConnectSessionAction.mockResolvedValue({
      ok: true,
      data: { connectUrl: 'https://connect.nango.test/session/session-token' },
    });

    render(
      <ConnectProviderButton provider="google-calendar">
        Connect Google Calendar
      </ConnectProviderButton>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Connect Google Calendar' }));
    await act(async () => {});

    act(() => {
      window.dispatchEvent(new Event('focus'));
      vi.advanceTimersByTime(0);
    });

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
