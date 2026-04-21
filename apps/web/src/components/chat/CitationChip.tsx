/**
 * Inline citation chip. Server-renderable. Links to the referenced
 * node / episode in the graph browser.
 */

import Link from 'next/link';

interface CitationChipProps {
  type: 'node' | 'episode';
  id: string;
  label: string;
}

export function CitationChip({ type, id, label }: CitationChipProps) {
  const href = type === 'node' ? `/memory/concept/${id}` : `/memory?ep=${id}`;
  return (
    <Link
      href={href as never}
      className="mx-0.5 inline-flex items-center rounded-sm border border-border bg-surface px-1 py-0.5 text-[11px] font-medium text-fg-muted hover:bg-accent hover:text-accent-fg"
      aria-label={`Open ${type} ${label}`}
    >
      <span className="mr-1 text-[9px] uppercase tracking-wide">{type}</span>
      {label}
    </Link>
  );
}
