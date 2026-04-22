/**
 * Client island for the month-view day-number header.
 *
 * Month cells deep-link into the week view anchored on that day. We keep
 * this button a Client Component so we can reuse `useRouter()` /
 * `useSearchParams()` without forcing the whole `DayCell` out of the
 * server render path.
 *
 * Styled in the V2 Indie voice: mono weekday tag + large day number, no
 * color chip on the number. The "today" state uses a thin accent
 * underline on the number instead of a filled pill.
 */

'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';

import { cn } from '@/lib/cn';

export interface DayCellNavButtonProps {
  cursor: string;
  label: string;
  isToday: boolean;
}

export function DayCellNavButton({ cursor, label, isToday }: DayCellNavButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const [weekday, dayNumber] = label.split(' ');

  function jumpToWeek() {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('view', 'week');
    params.set('cursor', cursor);
    const href = `${pathname}?${params.toString()}` as const;
    startTransition(() => {
      router.push(href as never);
    });
  }

  return (
    <button
      type="button"
      onClick={jumpToWeek}
      className={cn(
        'group flex items-baseline gap-1.5 rounded-[3px] px-0.5 py-0.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
      )}
      aria-label={`Open week view for ${label}`}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-fg-muted">
        {weekday}
      </span>
      <span
        className={cn(
          'text-[13.5px] tabular-nums text-fg',
          isToday ? 'font-semibold text-accent' : 'font-normal',
        )}
      >
        {dayNumber}
      </span>
    </button>
  );
}
