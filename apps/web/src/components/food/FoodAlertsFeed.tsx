/**
 * Renders a stack of food-segment alert cards. Mirrors the financial
 * feed's UX: severity pip, title, body, metadata row.
 */

import type { FoodAlertRow } from '@/lib/food/listFoodAlerts';

import { cn } from '@/lib/cn';


export interface FoodAlertsFeedProps {
  alerts: readonly FoodAlertRow[];
}

function severityClasses(severity: FoodAlertRow['severity']): string {
  if (severity === 'critical') return 'border-red-500/60 bg-red-500/5';
  if (severity === 'warn') return 'border-amber-500/60 bg-amber-500/5';
  return 'border-border bg-surface';
}

export function FoodAlertsFeed({ alerts }: FoodAlertsFeedProps) {
  if (alerts.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4 text-sm text-fg-muted">
        No active food alerts.
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {alerts.map((alert) => (
        <li
          key={alert.id}
          className={cn(
            'flex flex-col gap-1 rounded-lg border p-4 text-sm',
            severityClasses(alert.severity),
          )}
        >
          <div className="flex items-center gap-2">
            <span
              aria-label={`severity ${alert.severity}`}
              className={cn(
                'inline-block h-2 w-2 rounded-full',
                alert.severity === 'critical'
                  ? 'bg-red-500'
                  : alert.severity === 'warn'
                    ? 'bg-amber-500'
                    : 'bg-sky-500',
              )}
            />
            <span className="font-medium text-fg">{alert.title}</span>
          </div>
          <p className="text-fg-muted">{alert.body}</p>
          <div className="text-xs text-fg-muted">
            {alert.alertKind && <span className="mr-2">kind: {alert.alertKind}</span>}
            <span>{new Date(alert.generatedAt).toLocaleString()}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
