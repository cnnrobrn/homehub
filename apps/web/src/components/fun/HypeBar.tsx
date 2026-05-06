/**
 * `<HypeBar />` — countdown progress bar for upcoming queue items.
 *
 * The bar stays empty until the target date is within 30 days, then
 * fills linearly to 100% on the day-of. Items past their date show as
 * full ("happening now / past").
 */

import { Progress } from '@/components/ui/progress';

export const HYPE_WINDOW_DAYS = 30;
const MS_PER_DAY = 86_400_000;

export interface HypeFillResult {
  /** 0–100. */
  percent: number;
  /** Days remaining; negative if the target date has passed. */
  daysRemaining: number;
}

export function computeHypeFill(targetDateIso: string, now: Date = new Date()): HypeFillResult {
  const target = new Date(targetDateIso);
  if (Number.isNaN(target.getTime())) {
    return { percent: 0, daysRemaining: Number.POSITIVE_INFINITY };
  }
  const msRemaining = target.getTime() - now.getTime();
  const daysRemaining = Math.ceil(msRemaining / MS_PER_DAY);
  if (msRemaining <= 0) {
    return { percent: 100, daysRemaining };
  }
  if (daysRemaining >= HYPE_WINDOW_DAYS) {
    return { percent: 0, daysRemaining };
  }
  const elapsedInWindow = HYPE_WINDOW_DAYS - daysRemaining;
  const percent = Math.max(0, Math.min(100, (elapsedInWindow / HYPE_WINDOW_DAYS) * 100));
  return { percent, daysRemaining };
}

function fillLabel({ percent, daysRemaining }: HypeFillResult): string {
  if (daysRemaining < 0) return 'Past';
  if (daysRemaining === 0) return 'Today';
  if (percent === 0) return `In ${daysRemaining} days`;
  if (daysRemaining === 1) return 'Tomorrow';
  return `${daysRemaining} days to go`;
}

export interface HypeBarProps {
  targetDate: string;
  now?: Date;
}

export function HypeBar({ targetDate, now }: HypeBarProps) {
  const fill = computeHypeFill(targetDate, now);
  const label = fillLabel(fill);
  return (
    <div className="flex flex-col gap-1" aria-label={`Hype: ${label}`}>
      <Progress value={fill.percent} className="h-1.5" />
      <span className="text-[11px] uppercase tracking-wide text-fg-muted">{label}</span>
    </div>
  );
}
