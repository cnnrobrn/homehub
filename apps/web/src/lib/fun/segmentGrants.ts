/**
 * Segment grant helpers for the Fun segment.
 *
 * Mirrors the pattern in `@/lib/financial` — every server helper takes
 * optional `grants` and short-circuits when the caller lacks read
 * access. RLS is still the ultimate backstop; this is a perf + UX
 * nicety.
 */

export interface SegmentGrant {
  segment: string;
  access: 'none' | 'read' | 'write';
}

export function hasFunRead(grants: readonly SegmentGrant[]): boolean {
  return grants.some((g) => g.segment === 'fun' && (g.access === 'read' || g.access === 'write'));
}

export function hasFunWrite(grants: readonly SegmentGrant[]): boolean {
  return grants.some((g) => g.segment === 'fun' && g.access === 'write');
}
