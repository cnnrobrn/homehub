/**
 * `/social/alerts` — social segment alert feed.
 */

import { SocialRealtimeRefresher } from '@/components/social/SocialRealtimeRefresher';
import { getHouseholdContext } from '@/lib/auth/context';
import { listSocialAlerts, type SegmentGrant } from '@/lib/social';

export default async function SocialAlertsPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;
  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));
  const alerts = await listSocialAlerts({ householdId: ctx.household.id, limit: 100 }, { grants });

  if (alerts.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <SocialRealtimeRefresher householdId={ctx.household.id} />
        <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
          No alerts.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <SocialRealtimeRefresher householdId={ctx.household.id} />
      <ul role="list" className="flex flex-col gap-2">
        {alerts.map((a) => (
          <li key={a.id} className="rounded-lg border border-border bg-surface p-4 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold text-fg">{a.title}</h3>
              <span className="text-[11px] uppercase tracking-wide text-fg-muted">
                {a.severity}
              </span>
            </div>
            <p className="mt-1 text-fg-muted">{a.body}</p>
            <p className="mt-1 text-xs text-fg-muted">{new Date(a.generatedAt).toLocaleString()}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
