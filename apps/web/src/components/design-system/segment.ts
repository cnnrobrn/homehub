/**
 * Segment identity map.
 *
 * The app refers to four life segments both by their original keys
 * (`financial`, `food`, `fun`, `social`) and by the friendlier labels
 * the design uses in nav + headings (`Money`, `Food`, `Fun`, `People`).
 *
 * Colors resolve to CSS variables defined in `styles/tokens.css` and
 * surface through the Tailwind `@theme` bridge as `bg-segment-*`,
 * `text-segment-*`, `border-segment-*`. Using the CSS variable directly
 * (`style={{ background: 'var(--segment-food)' }}`) is preferred for
 * one-off color fills to avoid Tailwind arbitrary-value churn.
 */

export type SegmentId = 'financial' | 'food' | 'fun' | 'social';

export interface SegmentMeta {
  id: SegmentId;
  /** Friendly label from the design (e.g. "Money" for `financial`). */
  label: string;
  /** Internal key used by data layer + URLs. */
  slug: SegmentId;
  /** CSS variable reference (use with `style={{ background: color }}`). */
  color: string;
}

export const SEGMENTS: Record<SegmentId, SegmentMeta> = {
  financial: {
    id: 'financial',
    label: 'Money',
    slug: 'financial',
    color: 'var(--segment-financial)',
  },
  food: { id: 'food', label: 'Food', slug: 'food', color: 'var(--segment-food)' },
  fun: { id: 'fun', label: 'Fun', slug: 'fun', color: 'var(--segment-fun)' },
  social: { id: 'social', label: 'People', slug: 'social', color: 'var(--segment-social)' },
};

export const SEGMENT_ORDER: readonly SegmentId[] = ['financial', 'food', 'fun', 'social'];

export function segmentColor(id: SegmentId): string {
  return SEGMENTS[id].color;
}

export function segmentLabel(id: SegmentId): string {
  return SEGMENTS[id].label;
}
