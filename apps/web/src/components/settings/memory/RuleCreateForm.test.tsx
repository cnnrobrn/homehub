/**
 * @vitest-environment jsdom
 *
 * Tests for the `<RuleCreateForm>` client island.
 *
 * Focus:
 *   - Rejects empty description with a validation message.
 *   - Rejects malformed JSON in predicate DSL before hitting the server.
 *   - Calls `createRuleAction` with parsed predicate on success.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function setTextareaValue(el: HTMLTextAreaElement, value: string) {
  // React's synthetic onChange won't fire if we set `.value` directly
  // because the native setter shortcircuits. Invoke the prototype
  // setter then dispatch an input event so RHF registers the change.
  const proto = Object.getPrototypeOf(el);
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  descriptor?.set?.call(el, value);
  fireEvent.input(el, { target: { value } });
}

const createMock = vi.hoisted(() => vi.fn());

vi.mock('@/app/actions/memory', () => ({
  createRuleAction: createMock,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock('@/components/ui/use-toast', () => ({
  toast: () => {},
}));

import { RuleCreateForm } from './RuleCreateForm';

beforeEach(() => {
  createMock.mockReset();
  createMock.mockResolvedValue({ ok: true, data: { id: 'rule-1' } });
});

describe('RuleCreateForm', () => {
  it('refuses to submit with an empty description', async () => {
    const user = userEvent.setup();
    render(<RuleCreateForm />);
    await user.click(screen.getByRole('button', { name: /add rule/i }));
    await waitFor(() => {
      expect(screen.getByText(/description is required/i)).toBeInTheDocument();
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON in predicate DSL', async () => {
    const user = userEvent.setup();
    render(<RuleCreateForm />);
    await user.type(screen.getByLabelText(/description/i), 'no peanuts');
    // user-event's `type` interprets `{` as a modifier prefix. We set
    // the textarea value through the React prototype setter so
    // react-hook-form picks up the change without having to escape
    // braces.
    setTextareaValue(screen.getByLabelText(/predicate dsl/i) as HTMLTextAreaElement, '{not json');
    await user.click(screen.getByRole('button', { name: /add rule/i }));
    await waitFor(() => {
      expect(screen.getByText(/invalid json/i)).toBeInTheDocument();
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('calls createRuleAction with parsed predicate DSL', async () => {
    const user = userEvent.setup();
    render(<RuleCreateForm />);
    await user.type(screen.getByLabelText(/description/i), 'no peanuts');
    setTextareaValue(
      screen.getByLabelText(/predicate dsl/i) as HTMLTextAreaElement,
      '{"forbid":"peanut"}',
    );
    await user.click(screen.getByRole('button', { name: /add rule/i }));
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    expect(createMock).toHaveBeenCalledWith({
      description: 'no peanuts',
      predicateDsl: { forbid: 'peanut' },
    });
  });
});
