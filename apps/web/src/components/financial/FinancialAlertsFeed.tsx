/**
 * `<FinancialAlertsFeed />` — active + dismissed alerts list.
 *
 * Server Component. Each row pairs severity with an icon AND a text
 * label (accessibility: color alone is not a signal). Active alerts get
 * a client-island dismiss button and an evidence drawer trigger.
 */

import { AlertOctagon, AlertTriangle, Info } from 'lucide-react';

import { AlertDismissButton } from './AlertDismissButton';
import { AlertEvidenceDrawer } from './AlertEvidenceDrawer';

import type { AlertSeverity, FinancialAlertRow } from '@/lib/financial';

import { cn } from '@/lib/cn';

export interface FinancialAlertsFeedProps {
  alerts: FinancialAlertRow[];
}

const SEVERITY_ICON: Record<AlertSeverity, typeof AlertOctagon> = {
  critical: AlertOctagon,
  warn: AlertTriangle,
  info: Info,
};

const SEVERITY_TONE: Record<AlertSeverity, { border: string; bg: string; text: string }> = {
  critical: {
    border: 'border-danger/60',
    bg: 'bg-danger/5',
    text: 'text-danger',
  },
  warn: {
    border: 'border-warn/60',
    bg: 'bg-warn/5',
    text: 'text-warn',
  },
  info: {
    border: 'border-border',
    bg: 'bg-bg',
    text: 'text-fg-muted',
  },
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

export function FinancialAlertsFeed({ alerts }: FinancialAlertsFeedProps) {
  if (alerts.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
        No alerts yet.
      </div>
    );
  }

  return (
    <ul role="list" className="flex flex-col gap-2">
      {alerts.map((alert) => {
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
                  <span
                    className={cn('text-[11px] font-medium uppercase tracking-wide', tone.text)}
                  >
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
                      <span>
                        dismissed {alert.dismissedAt ? formatWhen(alert.dismissedAt) : ''}
                      </span>
                    </>
                  ) : null}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <AlertEvidenceDrawer alert={alert} />
                  {!dismissed ? <AlertDismissButton alertId={alert.id} /> : null}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
