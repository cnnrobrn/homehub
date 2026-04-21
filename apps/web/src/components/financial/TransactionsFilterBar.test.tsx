/**
 * @vitest-environment jsdom
 *
 * Behavioral tests for the transactions filter bar client island.
 *
 * Asserts that filter changes push new URLs with the expected query
 * params and that cursor params are reset on every filter edit.
 */

import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pushMock = vi.fn();
const mockUseSearchParams = vi.fn(() => new URLSearchParams());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
  usePathname: () => '/financial/transactions',
  useSearchParams: () => mockUseSearchParams(),
}));

import { TransactionsFilterBar } from './TransactionsFilterBar';

const ACCOUNTS = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Main' }];
const MEMBERS = [{ id: '22222222-2222-4222-8222-222222222222', name: 'Alex' }];
const SOURCES = ['ynab', 'email_receipt'];

beforeEach(() => {
  pushMock.mockReset();
  mockUseSearchParams.mockReturnValue(new URLSearchParams());
});

describe('<TransactionsFilterBar />', () => {
  it('pushes ?accountId=… on account selection', () => {
    const { getByLabelText } = render(
      <TransactionsFilterBar accounts={ACCOUNTS} members={MEMBERS} sources={SOURCES} />,
    );
    fireEvent.change(getByLabelText('Account'), { target: { value: ACCOUNTS[0]!.id } });
    expect(pushMock).toHaveBeenCalled();
    const href = pushMock.mock.calls[0]?.[0] as string;
    expect(href).toContain(`accountId=${ACCOUNTS[0]!.id}`);
  });

  it('clears the cursor params on each edit', () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams('before=abc&beforeAt=2026-04-01T00:00:00Z'),
    );
    const { getByLabelText } = render(
      <TransactionsFilterBar accounts={ACCOUNTS} members={MEMBERS} sources={SOURCES} />,
    );
    fireEvent.change(getByLabelText('Source'), { target: { value: 'ynab' } });
    const href = pushMock.mock.calls[0]?.[0] as string;
    expect(href).not.toContain('before=');
    expect(href).not.toContain('beforeAt=');
    expect(href).toContain('source=ynab');
  });
});
