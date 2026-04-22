/**
 * Inline citation chip. Server-renderable. Links to the referenced
 * node / episode in the graph browser.
 *
 * Styling is a quiet mono chip: hairline border, warm surface, no
 * fill on hover. Matches the metadata tags used across the V2 Indie
 * design system.
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
      className="mx-0.5 inline-flex items-center rounded-[3px] border border-border bg-surface-soft px-1 py-0.5 font-mono text-[10.5px] text-fg-muted transition-colors hover:bg-surface-note hover:text-fg"
      aria-label={`Open ${type} ${label}`}
    >
      <span className="mr-1 text-[9px] uppercase tracking-[0.06em]">{type}</span>
      {label}
    </Link>
  );
}
