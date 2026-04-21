/**
 * `<BudgetProgress />` — a single budget row.
 *
 * Server Component. Inline progress bar (no client state) with
 * threshold tones: over-budget (danger), near-budget (>80% → warn),
 * otherwise accent. Clicking the row opens the ledger filtered to the
 * budget's category.
 */

import { formatMoney, type Cents } from '@homehub/shared';
import Link from 'next/link';

import type { BudgetRow } from '@/lib/financial';

import { cn } from '@/lib/cn';

export interface BudgetProgressProps {
  budget: BudgetRow;
}

function formatPeriod(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

export function BudgetProgress({ budget }: BudgetProgressProps) {
  const progressPct = Math.min(100, Math.max(0, budget.progress * 100));
  const tone = budget.overBudget ? 'danger' : budget.nearBudget ? 'warn' : 'ok';
  const barColor = tone === 'danger' ? 'bg-danger' : tone === 'warn' ? 'bg-warn' : 'bg-accent';
  const label = budget.overBudget ? 'Over budget' : budget.nearBudget ? 'Near budget' : 'On track';
  return (
    <Link
      href={
        `/financial/transactions?from=${encodeURIComponent(budget.periodStart)}&to=${encodeURIComponent(
          budget.periodEnd,
        )}&search=${encodeURIComponent(budget.category)}` as never
      }
      aria-label={`${budget.name} budget — ${label}`}
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-border bg-surface p-4',
        'hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        budget.overBudget && 'border-danger/60',
        budget.nearBudget && 'border-warn/60',
      )}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-fg">{budget.name}</span>
          <span className="text-xs text-fg-muted">
            {budget.category} · {formatPeriod(budget.periodStart)}
          </span>
        </div>
        <span className="text-xs font-medium text-fg-muted">{label}</span>
      </header>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="tabular-nums text-fg">
          {formatMoney(budget.spentCents as Cents, budget.currency || 'USD')}
        </span>
        <span className="tabular-nums text-fg-muted">
          of {formatMoney(budget.amountCents as Cents, budget.currency || 'USD')}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(progressPct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${budget.name} progress`}
        className="relative h-2 w-full overflow-hidden rounded-full bg-border"
      >
        <div
          className={cn('h-full transition-all', barColor)}
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </Link>
  );
}
