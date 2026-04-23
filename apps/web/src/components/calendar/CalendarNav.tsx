/**
 * Prev / Today / Next navigation. Writes `?cursor=YYYY-MM-DD` and
 * (optionally) `?view=…` to the URL. The week/month step is derived
 * from the current view so month-view arrows don't move by one day.
 *
 * V2 Indie styling: ghost WarmButtons with the lowercase, typographic
 * arrows the handoff uses (`← last week` / `next week →`). The title
 * lives in the page header rather than here, so this row stays a
 * compact chrome strip.
 */

'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';

import type { CalendarView } from '@/lib/events/range';

import { WarmButton } from '@/components/design-system';
import { formatISODate } from '@/lib/events/range';

export interface CalendarNavProps {
  view: CalendarView;
  cursor: string; // ISO date YYYY-MM-DD
  /** Page-level caption (e.g. "Apr 19 – 25, 2026"). Rendered `aria-live`. */
  title: string;
}

function shiftCursor(cursor: string, view: CalendarView, direction: 1 | -1): string {
  const d = new Date(cursor);
  if (Number.isNaN(d.getTime())) return formatISODate(new Date());
  if (view === 'week') {
    d.setDate(d.getDate() + direction * 7);
  } else {
    d.setMonth(d.getMonth() + direction);
  }
  return formatISODate(d);
}

export function CalendarNav({ view, cursor, title }: CalendarNavProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function goTo(next: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('cursor', next);
    const href = `${pathname}?${params.toString()}` as const;
    startTransition(() => {
      router.push(href as never);
    });
  }

  const prevLabel = view === 'week' ? 'last week' : 'last month';
  const nextLabel = view === 'week' ? 'next week' : 'next month';

  return (
    <div className="flex items-center gap-1.5">
      <WarmButton
        variant="ghost"
        size="sm"
        aria-label={`Previous ${view}`}
        onClick={() => goTo(shiftCursor(cursor, view, -1))}
      >
        <span aria-hidden="true">{'←'}</span>
        <span>{prevLabel}</span>
      </WarmButton>
      <WarmButton
        variant="ghost"
        size="sm"
        onClick={() => goTo(formatISODate(new Date()))}
        aria-label="Jump to today"
      >
        today
      </WarmButton>
      <WarmButton
        variant="ghost"
        size="sm"
        aria-label={`Next ${view}`}
        onClick={() => goTo(shiftCursor(cursor, view, 1))}
      >
        <span>{nextLabel}</span>
        <span aria-hidden="true">{'→'}</span>
      </WarmButton>
      <span className="sr-only" aria-live="polite">
        {title}
      </span>
    </div>
  );
}
