/**
 * `<BirthdayCountdown />` — tiny pill showing how far away a birthday
 * is. Accessibility: ALWAYS carries a text label in addition to the
 * color — color alone is not a signal.
 */

import { cn } from '@/lib/cn';

export interface BirthdayCountdownProps {
  startsAt: string;
  now?: Date;
}

function daysUntil(startsAt: string, now: Date): number {
  const diff = new Date(startsAt).getTime() - now.getTime();
  return Math.round(diff / (24 * 60 * 60 * 1000));
}

function formatLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `${days}d away`;
}

function tone(days: number): string {
  if (days < 0) return 'border-border bg-bg text-fg-muted';
  if (days <= 2) return 'border-danger/60 bg-danger/10 text-danger';
  if (days <= 7) return 'border-warn/60 bg-warn/10 text-warn';
  return 'border-border bg-bg text-fg-muted';
}

export function BirthdayCountdown({ startsAt, now }: BirthdayCountdownProps) {
  const n = now ?? new Date();
  const days = daysUntil(startsAt, n);
  return (
    <span
      aria-label={formatLabel(days)}
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
        tone(days),
      )}
    >
      {formatLabel(days)}
    </span>
  );
}
