/**
 * Week / month toggle. Writes `?view=week|month` into the URL so the
 * calendar page (a Server Component) can read it on the next render.
 *
 * V2 Indie styling: hairline-bordered inline segmented control. The
 * active option becomes ink-on-surface; inactives are quiet mono text.
 */

'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';

import type { CalendarView } from '@/lib/events/range';

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
      className="inline-flex items-center rounded-[3px] border border-border bg-surface p-0.5"
    >
      {VIEWS.map((v) => {
        const active = current === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setView(v)}
            className={cn(
              'cursor-pointer rounded-[2px] px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.06em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              active ? 'bg-surface-soft text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            {v}
          </button>
        );
      })}
    </div>
  );
}
