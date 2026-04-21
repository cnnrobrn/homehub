/**
 * `/financial/alerts` — active + dismissed alerts, filterable by
 * severity.
 */

import Link from 'next/link';

import { FinancialAlertsFeed } from '@/components/financial/FinancialAlertsFeed';
import { FinancialRealtimeRefresher } from '@/components/financial/FinancialRealtimeRefresher';
import { getHouseholdContext } from '@/lib/auth/context';
import { cn } from '@/lib/cn';
import {
  ALERT_SEVERITIES,
  listFinancialAlerts,
  type AlertSeverity,
  type SegmentGrant,
} from '@/lib/financial';

export interface AlertsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstString(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

function parseSeverity(raw: string | undefined): AlertSeverity | undefined {
  if (!raw) return undefined;
  return (ALERT_SEVERITIES as readonly string[]).includes(raw) ? (raw as AlertSeverity) : undefined;
}

export default async function AlertsPage({ searchParams }: AlertsPageProps) {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const params = await searchParams;
  const severity = parseSeverity(firstString(params.severity));
  const showDismissed = firstString(params.include) === 'dismissed';

  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));

  const alerts = await listFinancialAlerts(
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
      <FinancialRealtimeRefresher householdId={ctx.household.id} />
      <div role="toolbar" aria-label="Filter alerts" className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-fg-muted">Severity:</span>
        <Link
          href="/financial/alerts"
          className={cn(pillBase, !severity && 'bg-surface font-medium text-fg')}
        >
          All
        </Link>
        {ALERT_SEVERITIES.map((s) => (
          <Link
            key={s}
            href={
              `/financial/alerts?severity=${s}${showDismissed ? '&include=dismissed' : ''}` as never
            }
            className={cn(pillBase, severity === s && 'bg-surface font-medium text-fg')}
          >
            {s}
          </Link>
        ))}
        <span className="ml-auto text-xs">
          <Link
            href={
              showDismissed
                ? (`/financial/alerts${severity ? `?severity=${severity}` : ''}` as never)
                : (`/financial/alerts?include=dismissed${severity ? `&severity=${severity}` : ''}` as never)
            }
            className={pillBase}
          >
            {showDismissed ? 'Hide dismissed' : 'Show dismissed'}
          </Link>
        </span>
      </div>
      <FinancialAlertsFeed alerts={alerts} />
    </div>
  );
}
