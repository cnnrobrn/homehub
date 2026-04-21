/**
 * `/fun/alerts` — active + dismissed fun alerts.
 */

import { AlertOctagon, AlertTriangle, Info } from 'lucide-react';
import Link from 'next/link';

import { FunRealtimeRefresher } from '@/components/fun/FunRealtimeRefresher';
import { getHouseholdContext } from '@/lib/auth/context';
import { cn } from '@/lib/cn';
import {
  FUN_ALERT_SEVERITIES,
  listFunAlerts,
  type FunAlertRow,
  type FunAlertSeverity,
  type SegmentGrant,
} from '@/lib/fun';

export interface AlertsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstString(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

function parseSeverity(raw: string | undefined): FunAlertSeverity | undefined {
  if (!raw) return undefined;
  return (FUN_ALERT_SEVERITIES as readonly string[]).includes(raw)
    ? (raw as FunAlertSeverity)
    : undefined;
}

const SEVERITY_ICON: Record<FunAlertSeverity, typeof AlertOctagon> = {
  critical: AlertOctagon,
  warn: AlertTriangle,
  info: Info,
};

const SEVERITY_TONE: Record<FunAlertSeverity, { border: string; bg: string; text: string }> = {
  critical: { border: 'border-danger/60', bg: 'bg-danger/5', text: 'text-danger' },
  warn: { border: 'border-warn/60', bg: 'bg-warn/5', text: 'text-warn' },
  info: { border: 'border-border', bg: 'bg-bg', text: 'text-fg-muted' },
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function renderAlert(alert: FunAlertRow) {
  const Icon = SEVERITY_ICON[alert.severity];
  const tone = SEVERITY_TONE[alert.severity];
  const dismissed = alert.dismissedAt !== null;
  return (
    <li
      key={alert.id}
      className={cn(
        'rounded-lg border bg-surface p-4',
        tone.border,
        tone.bg,
        dismissed && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-3">
        <Icon aria-hidden="true" className={cn('mt-0.5 h-5 w-5 shrink-0', tone.text)} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-fg">{alert.title}</h3>
            <span className={cn('text-[11px] font-medium uppercase tracking-wide', tone.text)}>
              {alert.severity}
            </span>
          </div>
          <p className="text-sm text-fg-muted">{alert.body}</p>
          <div className="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
            <span>{formatWhen(alert.generatedAt)}</span>
            {alert.alertKind ? (
              <>
                <span>·</span>
                <span>{alert.alertKind.replace(/_/g, ' ')}</span>
              </>
            ) : null}
            {dismissed ? (
              <>
                <span>·</span>
                <span>dismissed {alert.dismissedAt ? formatWhen(alert.dismissedAt) : ''}</span>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

export default async function FunAlertsPage({ searchParams }: AlertsPageProps) {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const params = await searchParams;
  const severity = parseSeverity(firstString(params.severity));
  const showDismissed = firstString(params.include) === 'dismissed';

  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));

  const alerts = await listFunAlerts(
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
      <FunRealtimeRefresher householdId={ctx.household.id} />
      <div role="toolbar" aria-label="Filter alerts" className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-fg-muted">Severity:</span>
        <Link
          href="/fun/alerts"
          className={cn(pillBase, !severity && 'bg-surface font-medium text-fg')}
        >
          All
        </Link>
        {FUN_ALERT_SEVERITIES.map((s) => (
          <Link
            key={s}
            href={`/fun/alerts?severity=${s}${showDismissed ? '&include=dismissed' : ''}` as never}
            className={cn(pillBase, severity === s && 'bg-surface font-medium text-fg')}
          >
            {s}
          </Link>
        ))}
        <span className="ml-auto text-xs">
          <Link
            href={
              showDismissed
                ? (`/fun/alerts${severity ? `?severity=${severity}` : ''}` as never)
                : (`/fun/alerts?include=dismissed${severity ? `&severity=${severity}` : ''}` as never)
            }
            className={pillBase}
          >
            {showDismissed ? 'Hide dismissed' : 'Show dismissed'}
          </Link>
        </span>
      </div>
      {alerts.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
          No alerts yet.
        </div>
      ) : (
        <ul role="list" className="flex flex-col gap-2">
          {alerts.map(renderAlert)}
        </ul>
      )}
    </div>
  );
}
