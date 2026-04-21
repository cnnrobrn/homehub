/**
 * @vitest-environment jsdom
 *
 * Smoke tests for the HouseholdSwitcher client component.
 *
 * The switcher collapses to a read-only label when the member only has
 * one household — this is the load-bearing edge case we care about not
 * regressing.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { HouseholdSwitcher } from './HouseholdSwitcher';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

vi.mock('@/app/actions/auth', () => ({
  setActiveHouseholdAction: async () => ({ ok: true, data: { ok: true } }),
}));

describe('HouseholdSwitcher', () => {
  it('collapses to a read-only label when the user has one household', () => {
    render(
      <HouseholdSwitcher
        activeId="h1"
        activeName="Casa Martin"
        households={[{ id: 'h1', name: 'Casa Martin', role: 'owner' }]}
      />,
    );
    expect(screen.getByText('Casa Martin')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /switch household/i })).not.toBeInTheDocument();
  });

  it('renders a dropdown trigger when multiple households exist', () => {
    render(
      <HouseholdSwitcher
        activeId="h1"
        activeName="Casa Martin"
        households={[
          { id: 'h1', name: 'Casa Martin', role: 'owner' },
          { id: 'h2', name: 'Beach House', role: 'adult' },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: /switch household/i })).toBeInTheDocument();
  });
});
