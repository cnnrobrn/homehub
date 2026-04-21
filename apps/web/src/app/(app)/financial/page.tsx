/**
 * `/financial` — Financial segment dashboard.
 *
 * Server Component. Pulls the latest summary, account health, active
 * alerts, pending suggestions, and upcoming autopay charges. The
 * layout already gates on `financial:read`; this page assumes access.
 */

import { formatMoney, type Cents } from '@homehub/shared';
import Link from 'next/link';

import { AccountCard } from '@/components/financial/AccountCard';
import { FinancialAlertsFeed } from '@/components/financial/FinancialAlertsFeed';
import { FinancialRealtimeRefresher } from '@/components/financial/FinancialRealtimeRefresher';
import { getHouseholdContext } from '@/lib/auth/context';
import {
  listAccounts,
  listFinancialAlerts,
  listFinancialSuggestions,
  listFinancialSummaries,
  listSubscriptions,
  type SegmentGrant,
} from '@/lib/financial';

const MS_PER_DAY = 86_400_000;

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - Date.now()) / MS_PER_DAY);
}

export default async function FinancialDashboardPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));

  const [accounts, alerts, suggestions, summaries, subscriptions] = await Promise.all([
    listAccounts({ householdId: ctx.household.id }, { grants }),
    listFinancialAlerts({ householdId: ctx.household.id, limit: 20 }, { grants }),
    listFinancialSuggestions({ householdId: ctx.household.id }, { grants }),
    listFinancialSummaries({ householdId: ctx.household.id, limit: 2 }, { grants }),
    listSubscriptions({ householdId: ctx.household.id }, { grants }),
  ]);

  const activeAlerts = alerts.filter(
    (a) => a.dismissedAt === null && (a.severity === 'critical' || a.severity === 'warn'),
  );
  const latestSummary = summaries[0] ?? null;
  const upcoming = subscriptions
    .map((s) => ({ sub: s, days: daysUntil(s.nextChargeAt) }))
    .filter((s) => s.days !== null && s.days >= 0 && s.days <= 14)
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
    .slice(0, 6);

  return (
    <div className="flex flex-col gap-6">
      <FinancialRealtimeRefresher householdId={ctx.household.id} />

      <section aria-labelledby="mtd-heading" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 id="mtd-heading" className="text-xs uppercase tracking-wide text-fg-muted">
            Latest summary
          </h2>
          {latestSummary ? (
            <div className="mt-2 flex flex-col gap-1">
              <span className="text-sm font-semibold text-fg">
                {latestSummary.period === 'week' ? 'This week' : 'This month'}
              </span>
              <span className="text-xs text-fg-muted">
                Covers {new Date(latestSummary.coveredStart).toLocaleDateString()} –{' '}
                {new Date(latestSummary.coveredEnd).toLocaleDateString()}
              </span>
              <Link
                href="/financial/summaries"
                className="mt-2 text-xs text-accent hover:underline"
              >
                Open summaries
              </Link>
            </div>
          ) : (
            <p className="mt-2 text-sm text-fg-muted">
              No summaries yet. They generate weekly after the first sync completes.
            </p>
          )}
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-xs uppercase tracking-wide text-fg-muted">Pending suggestions</h2>
          {suggestions.length === 0 ? (
            <p className="mt-2 text-sm text-fg-muted">Nothing waiting for review.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2 text-sm">
              {suggestions.slice(0, 3).map((s) => (
                <li key={s.id} className="flex flex-col">
                  <span className="font-medium text-fg">{s.title}</span>
                  <span className="text-xs text-fg-muted">{s.rationale}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="health-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 id="health-heading" className="text-lg font-medium">
            Account health
          </h2>
          <Link href="/financial/accounts" className="text-xs text-accent hover:underline">
            All accounts
          </Link>
        </div>
        {accounts.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface p-4 text-sm text-fg-muted">
            No accounts synced yet. Connect YNAB or Plaid in{' '}
            <Link
              href="/settings/connections"
              className="text-accent underline underline-offset-2 hover:no-underline"
            >
              settings
            </Link>
            .
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.slice(0, 6).map((a) => (
              <AccountCard key={a.id} account={a} />
            ))}
          </div>
        )}
      </section>

      {activeAlerts.length > 0 ? (
        <section aria-labelledby="alerts-heading" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 id="alerts-heading" className="text-lg font-medium">
              Active alerts
            </h2>
            <Link href="/financial/alerts" className="text-xs text-accent hover:underline">
              All alerts
            </Link>
          </div>
          <FinancialAlertsFeed alerts={activeAlerts} />
        </section>
      ) : null}

      <section aria-labelledby="autopay-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 id="autopay-heading" className="text-lg font-medium">
            Upcoming autopays (next 14 days)
          </h2>
          <Link href="/financial/subscriptions" className="text-xs text-accent hover:underline">
            All subscriptions
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface p-4 text-sm text-fg-muted">
            Nothing projected in the next two weeks.
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {upcoming.map(({ sub, days }) => (
              <li key={sub.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div className="flex flex-col">
                  <span className="font-medium text-fg">{sub.canonicalName}</span>
                  <span className="text-xs text-fg-muted">
                    {days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`} ·{' '}
                    {sub.cadence}
                  </span>
                </div>
                <span className="tabular-nums text-fg-muted">
                  {sub.priceCents === null
                    ? '—'
                    : formatMoney(sub.priceCents as Cents, sub.currency || 'USD')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
