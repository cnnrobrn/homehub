/**
 * Week / month toggle. Writes `?view=week|month` into the URL so the
 * calendar page (a Server Component) can read it on the next render.
 */

'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';

import type { CalendarView } from '@/lib/events/range';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export interface ViewToggleProps {
  current: CalendarView;
}

const VIEWS: CalendarView[] = ['week', 'month'];

export function ViewToggle({ current }: ViewToggleProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function setView(next: CalendarView) {
    if (next === current) return;
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('view', next);
    const href = `${pathname}?${params.toString()}` as const;
    startTransition(() => {
      router.push(href as never);
    });
  }

  return (
    <div
      role="radiogroup"
      aria-label="Calendar view"
      className="inline-flex items-center gap-1 rounded-md border border-border bg-surface p-0.5"
    >
      {VIEWS.map((v) => (
        <Button
          key={v}
          role="radio"
          aria-checked={current === v}
          variant={current === v ? 'secondary' : 'ghost'}
          size="sm"
          className={cn('capitalize', current === v && 'bg-bg text-fg')}
          onClick={() => setView(v)}
        >
          {v}
        </Button>
      ))}
    </div>
  );
}
