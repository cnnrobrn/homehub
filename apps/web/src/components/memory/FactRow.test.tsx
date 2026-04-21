/**
 * @vitest-environment jsdom
 *
 * Client-side tests for `FactRow`.
 *
 * Focus: the Confirm/Dispute/Delete affordances open the correct
 * menu items and call the corresponding server action. The
 * "Show evidence" trigger opens the sibling drawer (we just assert
 * the trigger is present and accessible; the drawer's own test
 * covers the open/close cycle).
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const confirmMock = vi.hoisted(() => vi.fn());
const disputeMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());

vi.mock('@/app/actions/memory', () => ({
  confirmFactAction: confirmMock,
  disputeFactAction: disputeMock,
  deleteFactAction: deleteMock,
  editFactAction: vi.fn(async () => ({ ok: true, data: { candidateId: 'x' } })),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock('@/components/ui/use-toast', () => ({
  toast: () => {},
}));

import { FactRow, type FactRowData } from './FactRow';

function baseFact(overrides: Partial<FactRowData> = {}): FactRowData {
  return {
    id: 'f1',
    predicate: 'age',
    object_value: 31,
    object_node_id: null,
    confidence: 0.9,
    valid_from: '2026-04-01T00:00:00Z',
    valid_to: null,
    source: 'extraction',
    conflict_status: 'none',
    reinforcement_count: 1,
    evidence: [],
    superseded_at: null,
    superseded_by: null,
    ...overrides,
  };
}

beforeEach(() => {
  confirmMock.mockReset();
  disputeMock.mockReset();
  deleteMock.mockReset();
  confirmMock.mockResolvedValue({ ok: true, data: { candidateId: 'c' } });
  disputeMock.mockResolvedValue({ ok: true, data: { candidateId: 'c' } });
  deleteMock.mockResolvedValue({ ok: true, data: { candidateId: 'c' } });
});

describe('FactRow', () => {
  it('renders predicate and object value', () => {
    render(
      <ul>
        <FactRow subjectLabel="Sarah" fact={baseFact()} />
      </ul>,
    );
    expect(screen.getByText('age')).toBeInTheDocument();
    expect(screen.getByText('31')).toBeInTheDocument();
  });

  it('renders the evidence trigger', () => {
    render(
      <ul>
        <FactRow subjectLabel="Sarah" fact={baseFact()} />
      </ul>,
    );
    expect(screen.getByRole('button', { name: /Show evidence/i })).toBeInTheDocument();
  });

  it('invokes confirmFactAction when the menu option is chosen', async () => {
    const user = userEvent.setup();
    render(
      <ul>
        <FactRow subjectLabel="Sarah" fact={baseFact()} />
      </ul>,
    );
    await user.click(screen.getByLabelText(/Actions for fact age/i));
    await user.click(screen.getByRole('menuitem', { name: 'Confirm' }));
    expect(confirmMock).toHaveBeenCalledWith({ factId: 'f1' });
  });

  it('renders the conflict pip when the fact has a conflict', () => {
    render(
      <ul>
        <FactRow subjectLabel="Sarah" fact={baseFact({ conflict_status: 'unresolved' })} />
      </ul>,
    );
    expect(screen.getByRole('status', { name: /Conflict/i })).toBeInTheDocument();
  });
});
