/**
 * Client island for the month-view day-number header.
 *
 * Month cells deep-link into the week view anchored on that day. We keep
 * this button a Client Component so we can reuse `useRouter()` /
 * `useSearchParams()` without forcing the whole `DayCell` out of the
 * server render path.
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
        'rounded-sm px-1 py-0.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        isToday && 'bg-accent text-accent-fg',
      )}
      aria-label={`Open week view for ${label}`}
    >
      {label}
    </button>
  );
}
