/**
 * Model-budget card.
 *
 * Server shell renders the current MTD spend + progress bar. The
 * `<BudgetInput>` client island handles the owner-only edit.
 */

import { BudgetInput } from './BudgetInput';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

export interface ModelBudgetCardProps {
  isOwner: boolean;
  currentCents: number;
  mtdUsd: number;
  monthStartIso: string;
}

function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
}

export function ModelBudgetCard({
  isOwner,
  currentCents,
  mtdUsd,
  monthStartIso,
}: ModelBudgetCardProps) {
  const budgetUsd = currentCents / 100;
  const ratio = budgetUsd > 0 ? Math.min(100, (mtdUsd / budgetUsd) * 100) : 0;
  const over = budgetUsd > 0 && mtdUsd / budgetUsd > 1;
  const warn = budgetUsd > 0 && ratio >= 80;

  const monthLabel = new Date(monthStartIso).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Model budget</CardTitle>
        <CardDescription>
          The cap on how much HomeHub is allowed to spend on LLM calls this month. Setting 0
          disables the cap — the budget guard treats it as unlimited.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">This month ({monthLabel})</span>
            <span
              className={
                over
                  ? 'text-sm font-semibold text-danger'
                  : warn
                    ? 'text-sm font-semibold text-warn'
                    : 'text-sm text-fg-muted'
              }
              aria-live="polite"
            >
              {`$${mtdUsd.toFixed(2)} of ${formatUsd(currentCents)} budget`}
              {budgetUsd > 0 ? ` — ${Math.round(ratio)}%` : null}
            </span>
          </div>
          <Progress
            value={ratio}
            aria-label="Month-to-date model spend"
            className={over ? 'bg-danger/20' : undefined}
          />
        </div>

        <BudgetInput initialCents={currentCents} disabled={!isOwner} />
      </CardContent>
    </Card>
  );
}
