/**
 * `/food/alerts` — active + dismissed alerts, filterable by severity.
 */

import Link from 'next/link';

import { FoodAlertsFeed } from '@/components/food/FoodAlertsFeed';
import { FoodRealtimeRefresher } from '@/components/food/FoodRealtimeRefresher';
import { getHouseholdContext } from '@/lib/auth/context';
import { cn } from '@/lib/cn';
import {
  FOOD_ALERT_SEVERITIES,
  listFoodAlerts,
  type FoodAlertSeverity,
  type SegmentGrant,
} from '@/lib/food';

export interface FoodAlertsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstString(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

function parseSeverity(raw: string | undefined): FoodAlertSeverity | undefined {
  if (!raw) return undefined;
  return (FOOD_ALERT_SEVERITIES as readonly string[]).includes(raw)
    ? (raw as FoodAlertSeverity)
    : undefined;
}

export default async function FoodAlertsPage({ searchParams }: FoodAlertsPageProps) {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;
  const params = await searchParams;
  const severity = parseSeverity(firstString(params.severity));
  const showDismissed = firstString(params.include) === 'dismissed';
  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));
  const alerts = await listFoodAlerts(
    {
      householdId: ctx.household.id,
      severities: severity ? [severity] : undefined,
      includeDismissed: showDismissed,
      limit: 100,
    },
    { grants },
  );
  const pillBase =
    'rounded-sm border border-border bg-bg px-2 py-1 text-xs text-fg-muted hover:text-fg';
  return (
    <div className="flex flex-col gap-4">
      <FoodRealtimeRefresher householdId={ctx.household.id} />
      <div role="toolbar" aria-label="Filter alerts" className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-fg-muted">Severity:</span>
        <Link
          href="/food/alerts"
          className={cn(pillBase, !severity && 'bg-surface font-medium text-fg')}
        >
          All
        </Link>
        {FOOD_ALERT_SEVERITIES.map((s) => (
          <Link
            key={s}
            href={`/food/alerts?severity=${s}${showDismissed ? '&include=dismissed' : ''}` as never}
            className={cn(pillBase, severity === s && 'bg-surface font-medium text-fg')}
          >
            {s}
          </Link>
        ))}
        <span className="ml-auto text-xs">
          <Link
            href={
              showDismissed
                ? (`/food/alerts${severity ? `?severity=${severity}` : ''}` as never)
                : (`/food/alerts?include=dismissed${severity ? `&severity=${severity}` : ''}` as never)
            }
            className={pillBase}
          >
            {showDismissed ? 'Hide dismissed' : 'Show dismissed'}
          </Link>
        </span>
      </div>
      <FoodAlertsFeed alerts={alerts} />
    </div>
  );
}
