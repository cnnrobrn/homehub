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
 */

'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';

import { SEGMENT_DOT_CLASS, SEGMENT_LABEL } from './segmentStyles';

import type { Segment } from '@/lib/events/listEvents';

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/cn';

export interface SegmentFilterProps {
  available: Segment[];
  selected: Segment[];
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
      className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface px-3 py-2"
    >
      <legend className="sr-only">Segment filter</legend>
      {available.map((segment) => {
        const id = `segment-filter-${segment}`;
        const checked = selected.includes(segment);
        return (
          <div key={segment} className="flex items-center gap-2">
            <Checkbox
              id={id}
              checked={checked}
              onCheckedChange={(value) => toggle(segment, value === true)}
            />
            <Label htmlFor={id} className="flex cursor-pointer items-center gap-1.5 text-xs">
              <span
                aria-hidden="true"
                className={cn('h-2.5 w-2.5 rounded-full', SEGMENT_DOT_CLASS[segment])}
              />
              {SEGMENT_LABEL[segment]}
            </Label>
          </div>
        );
      })}
    </fieldset>
  );
}
