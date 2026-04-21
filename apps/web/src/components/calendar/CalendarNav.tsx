/**
 * Prev / Today / Next navigation. Writes `?cursor=YYYY-MM-DD` and
 * (optionally) `?view=…` to the URL. The week/month step is derived
 * from the current view so month-view arrows don't move by one day.
 */

'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';

import type { CalendarView } from '@/lib/events/range';

import { Button } from '@/components/ui/button';
import { formatISODate } from '@/lib/events/range';

export interface CalendarNavProps {
  view: CalendarView;
  cursor: string; // ISO date YYYY-MM-DD
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

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        aria-label={`Previous ${view}`}
        onClick={() => goTo(shiftCursor(cursor, view, -1))}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => goTo(formatISODate(new Date()))}
        aria-label="Jump to today"
      >
        Today
      </Button>
      <Button
        variant="outline"
        size="sm"
        aria-label={`Next ${view}`}
        onClick={() => goTo(shiftCursor(cursor, view, 1))}
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Button>
      <h2 className="ml-2 text-base font-medium tracking-tight" aria-live="polite">
        {title}
      </h2>
    </div>
  );
}
