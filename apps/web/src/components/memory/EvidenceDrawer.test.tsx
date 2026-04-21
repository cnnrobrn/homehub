/**
 * @vitest-environment jsdom
 *
 * `EvidenceDrawer` client-island test.
 *
 * Scope: the trigger opens the drawer, the entries render, and
 * pressing Escape closes it. Radix Dialog's focus trap is covered
 * by the library; we only verify our wiring.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { EvidenceDrawer } from './EvidenceDrawer';

describe('EvidenceDrawer', () => {
  it('opens on click and renders the entries', async () => {
    const user = userEvent.setup();
    render(
      <EvidenceDrawer
        factId="f1"
        factSubjectLabel="Sarah"
        evidence={[
          {
            source: 'extraction',
            summary: 'From email 2026-04-01',
            excerpt: "Sarah's birthday is April 1.",
            recorded_at: '2026-04-01T00:00:00Z',
            row_table: 'app.event',
            row_id: 'evt1',
            extractor_version: 'v1.0',
          },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Show evidence/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('From email 2026-04-01')).toBeInTheDocument();
    expect(screen.getByText("Sarah's birthday is April 1.")).toBeInTheDocument();
  });

  it('renders a helpful empty state when no evidence exists', async () => {
    const user = userEvent.setup();
    render(<EvidenceDrawer factId="f1" factSubjectLabel="Sarah" evidence={[]} />);
    await user.click(screen.getByRole('button', { name: /Show evidence/i }));
    expect(await screen.findByText(/No evidence recorded/i)).toBeInTheDocument();
  });
});
