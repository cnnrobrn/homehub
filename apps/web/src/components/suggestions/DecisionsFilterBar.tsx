/**
 * `<DecisionsFilterBar />` — quiet chip-style filters for the Decisions
 * page.
 *
 * Renders segment + status filters as hairline-bordered chips that
 * submit as plain links (`?segment=…&status=…`). No JavaScript is
 * required for filtering to work — the Decisions surface is a Server
 * Component, and we want the filter UI to stay on the happy path even
 * when the client bundle hasn't arrived yet.
 *
 * The segment set here intentionally omits `system` because the
 * unified inbox shows system-flagged suggestions under their closest
 * life-segment colour; callers who need system-filtered views can still
 * reach them by typing `?segment=system` in the URL.
 */

import Link from 'next/link';

import { SegDot, SEGMENTS, type SegmentId } from '@/components/design-system';
import { cn } from '@/lib/cn';

export interface DecisionsFilterBarProps {
  segment: SegmentId | null;
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'expired';
  kind: string | null;
}

const SEGMENT_OPTIONS: readonly SegmentId[] = ['financial', 'food', 'fun', 'social'];
const STATUS_OPTIONS: readonly DecisionsFilterBarProps['status'][] = [
  'pending',
  'approved',
  'rejected',
  'executed',
  'expired',
];

function STATUS_LABEL(s: DecisionsFilterBarProps['status']): string {
  switch (s) {
    case 'pending':
      return 'waiting';
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'set aside';
    case 'executed':
      return 'done';
    case 'expired':
      return 'let go';
  }
}

function buildHref(
  params: Partial<{ segment: SegmentId | null; status: string; kind: string | null }>,
): string {
  const q = new URLSearchParams();
  if (params.segment) q.set('segment', params.segment);
  if (params.status && params.status !== 'pending') q.set('status', params.status);
  if (params.kind) q.set('kind', params.kind);
  const qs = q.toString();
  return qs ? `/suggestions?${qs}` : '/suggestions';
}

function Chip({
  active,
  children,
  href,
  dotSegment,
  muted = false,
}: {
  active: boolean;
  children: React.ReactNode;
  href: string;
  dotSegment?: SegmentId;
  muted?: boolean;
}) {
  return (
    <Link
      href={href as never}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[3px] border px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.06em] transition-colors',
        active
          ? 'border-fg bg-surface text-fg'
          : muted
            ? 'border-transparent bg-transparent text-fg-muted hover:text-fg'
            : 'border-border bg-surface text-fg-muted hover:text-fg',
      )}
    >
      {dotSegment ? <SegDot segment={dotSegment} size={6} /> : null}
      <span>{children}</span>
    </Link>
  );
}

export function DecisionsFilterBar({ segment, status, kind }: DecisionsFilterBarProps) {
  const anyActive = segment !== null || status !== 'pending' || kind !== null;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip active={segment === null} href={buildHref({ segment: null, status, kind })}>
          all
        </Chip>
        {SEGMENT_OPTIONS.map((s) => (
          <Chip
            key={s}
            dotSegment={s}
            active={segment === s}
            href={buildHref({ segment: s, status, kind })}
          >
            {SEGMENTS[s].label.toLowerCase()}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {STATUS_OPTIONS.map((s) => (
          <Chip key={s} active={status === s} muted href={buildHref({ segment, status: s, kind })}>
            {STATUS_LABEL(s)}
          </Chip>
        ))}
        {anyActive ? (
          <Link
            href="/suggestions"
            className="ml-auto font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-muted underline-offset-2 hover:underline"
          >
            clear
          </Link>
        ) : null}
      </div>
      {kind ? (
        <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-muted">
          kind · {kind.replace(/_/g, ' ')}
        </div>
      ) : null}
    </div>
  );
}
