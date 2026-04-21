/**
 * Segment → Tailwind class mapping.
 *
 * Kept as a module-level constant so it tree-shakes cleanly and stays in
 * sync with the palette declared in `tokens.css` + `globals.css`.
 * Tailwind v4 reads the arbitrary-value `bg-[var(--…)]` at compile time
 * and emits exactly the classes referenced here.
 */

import type { Segment } from '@/lib/events/listEvents';

export const SEGMENT_DOT_CLASS: Record<Segment, string> = {
  financial: 'bg-[var(--segment-financial)]',
  food: 'bg-[var(--segment-food)]',
  fun: 'bg-[var(--segment-fun)]',
  social: 'bg-[var(--segment-social)]',
  system: 'bg-[var(--segment-system)]',
};

export const SEGMENT_BORDER_CLASS: Record<Segment, string> = {
  financial: 'border-l-[var(--segment-financial)]',
  food: 'border-l-[var(--segment-food)]',
  fun: 'border-l-[var(--segment-fun)]',
  social: 'border-l-[var(--segment-social)]',
  system: 'border-l-[var(--segment-system)]',
};

export const SEGMENT_LABEL: Record<Segment, string> = {
  financial: 'Financial',
  food: 'Food',
  fun: 'Fun',
  social: 'Social',
  system: 'System',
};
