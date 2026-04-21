/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ToolCard } from './ToolCard';

describe('ToolCard', () => {
  it('renders summary for a query_memory call', () => {
    render(
      <ToolCard
        call={{
          id: 'c1',
          tool: 'query_memory',
          classification: 'read',
          arguments: { query: 'hi' },
          result: { nodes: [{}, {}], facts: [{}] },
          ok: true,
        }}
      />,
    );
    expect(screen.getByText(/searched "hi"/i)).toBeInTheDocument();
  });

  it('expands on click to show args and result', () => {
    render(
      <ToolCard
        call={{
          id: 'c1',
          tool: 'list_events',
          classification: 'read',
          arguments: { from: 'x', to: 'y' },
          result: { events: [] },
          ok: true,
        }}
      />,
    );
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/args:/i)).toBeInTheDocument();
  });

  it('flags failed tool calls', () => {
    render(
      <ToolCard
        call={{
          id: 'c1',
          tool: 'list_events',
          classification: 'read',
          arguments: {},
          result: null,
          ok: false,
          error: { code: 'bad', message: 'bad input' },
        }}
      />,
    );
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
  });
});
