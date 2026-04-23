/**
 * Segment filter — renders one checkbox per segment the member has read
 * access to. Writes the current selection into `?segments=…` as a
 * comma-separated list. Empty list in the URL means "no filter" (default
 * to all-readable-segments); clearing a checkbox sets the URL explicitly.
 *
 * The parent server page is responsible for deciding which segments to
 * pass in; if the member lacks read on a segment, it simply isn't
 * rendered here (per the RLS-honest UI rule in
 * `specs/07-frontend/ui-architecture.md`).
 *
 * V2 Indie styling: the legend reads as a quiet mono "— filter" eyebrow;
 * each segment pairs its colored dot with its label. The segment
 * label here uses the friendly design label (Money / Food / Fun /
 * People) when the segment is one of the four user segments.
 */

'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';

import { SEGMENT_LABEL } from './segmentStyles';

import type { Segment } from '@/lib/events/listEvents';

import { SegDot, SEGMENTS as SEGMENT_META, type SegmentId } from '@/components/design-system';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/cn';

export interface SegmentFilterProps {
  available: Segment[];
  selected: Segment[];
}

function isAppSegment(s: Segment): s is SegmentId {
  return s === 'financial' || s === 'food' || s === 'fun' || s === 'social';
}

function labelFor(segment: Segment): string {
  return isAppSegment(segment) ? SEGMENT_META[segment].label : SEGMENT_LABEL[segment];
}

export function SegmentFilter({ available, selected }: SegmentFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function toggle(segment: Segment, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(segment);
    else next.delete(segment);

    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (next.size === 0 || next.size === available.length) {
      // All selected == no filter; zero selected is an explicit "none".
      if (next.size === 0) {
        params.set('segments', 'none');
      } else {
        params.delete('segments');
      }
    } else {
      params.set(
        'segments',
        [...next]
          .filter((s): s is Segment => available.includes(s))
          .sort()
          .join(','),
      );
    }
    const href = `${pathname}?${params.toString()}` as const;
    startTransition(() => {
      router.push(href as never);
    });
  }

  return (
    <fieldset
      aria-label="Filter events by segment"
      className="flex flex-wrap items-center gap-x-5 gap-y-2"
    >
      <legend className="sr-only">Segment filter</legend>
      <span
        aria-hidden="true"
        className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-muted"
      >
        {'— filter'}
      </span>
      {available.map((segment) => {
        const id = `segment-filter-${segment}`;
        const checked = selected.includes(segment);
        const label = labelFor(segment);
        return (
          <div key={segment} className="flex items-center gap-2">
            <Checkbox
              id={id}
              checked={checked}
              onCheckedChange={(value) => toggle(segment, value === true)}
              aria-label={SEGMENT_LABEL[segment]}
            />
            <Label
              htmlFor={id}
              className={cn(
                'flex cursor-pointer items-center gap-1.5 text-[12px]',
                checked ? 'text-fg' : 'text-fg-muted',
              )}
            >
              {isAppSegment(segment) ? (
                <SegDot segment={segment} size={7} />
              ) : (
                <span
                  aria-hidden="true"
                  className="inline-block h-[7px] w-[7px] rounded-full"
                  style={{ background: 'var(--segment-system)' }}
                />
              )}
              {label}
            </Label>
          </div>
        );
      })}
    </fieldset>
  );
}
