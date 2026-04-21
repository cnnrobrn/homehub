/**
 * @vitest-environment jsdom
 *
 * Lightweight snapshot for `NodeHeader` — covers the
 * `needs_review` badge wiring and the canonical-name render.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/actions/memory', () => ({
  pinNodeAction: vi.fn(),
  unpinNodeAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock('@/components/ui/use-toast', () => ({
  toast: () => {},
}));

import { NodeHeader } from './NodeHeader';

import type { NodeRow } from '@/lib/memory/query';

function baseNode(overrides: Partial<NodeRow> = {}): NodeRow {
  return {
    id: 'n1',
    household_id: 'h1',
    type: 'person',
    canonical_name: 'Sarah',
    document_md: null,
    manual_notes_md: null,
    metadata: {},
    embedding: null,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-05T00:00:00Z',
    needs_review: false,
    ...overrides,
  };
}

describe('NodeHeader', () => {
  it('renders the canonical name + type badge', () => {
    render(<NodeHeader node={baseNode()} pinned={false} />);
    expect(screen.getByRole('heading', { name: /Sarah/i })).toBeInTheDocument();
    expect(screen.getByText('Person')).toBeInTheDocument();
  });

  it('shows the needs-review badge when flagged', () => {
    render(<NodeHeader node={baseNode({ needs_review: true })} pinned={false} />);
    expect(screen.getByText('Needs review')).toBeInTheDocument();
  });

  it('hides the needs-review badge when clear', () => {
    render(<NodeHeader node={baseNode({ needs_review: false })} pinned={false} />);
    expect(screen.queryByText('Needs review')).not.toBeInTheDocument();
  });
});
