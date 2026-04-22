/**
 * `/financial` — Money segment landing ("V2 Indie").
 *
 * Same gentle shape as the other three segment landings:
 *   1. PageHeader — segment-dot eyebrow + first-person headline + sub.
 *   2. Worth a look — up to two LookCards stamped with the financial
 *      (green) accent stripe. Falls back to a quiet empty card.
 *   3. Warm two-column grid — "Coming up" list (next autopays) on the
 *      left, "Running totals" FactList (accounts snapshot) on the
 *      right.
 *   4. "Things the house remembers" — FactList of recent summaries +
 *      any active alerts, under a mono section head.
 *   5. Gentle footer — quiet mono caption.
 *
 * Data comes from the existing grant-aware readers. A member without
 * `financial:read` sees a calm denied card instead of a broken page.
 * The realtime refresher stays wired so inbound writes repaint the
 * surface.
 */

import { formatMoney, type Cents } from '@homehub/shared';
import Link from 'next/link';

import {
  FactList,
  LookCard,
  PageHeader,
  SectionHead,
  SegDot,
  WarmButton,
} from '@/components/design-system';
import { FinancialRealtimeRefresher } from '@/components/financial/FinancialRealtimeRefresher';
import { getHouseholdContext } from '@/lib/auth/context';
import {
  hasFinancialRead,
  listAccounts,
  listFinancialAlerts,
  listFinancialSuggestions,
  listFinancialSummaries,
  listSubscriptions,
  type SegmentGrant,
} from '@/lib/financial';

const MS_PER_DAY = 86_400_000;
const LOOKS_LIMIT = 2;

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - Date.now()) / MS_PER_DAY);
}

function whenLabel(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

function formatRange(startIso: string, endIso: string): string {
  const s = new Date(startIso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  const e = new Date(endIso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  return `${s} – ${e}`;
}

function money(cents: number | null, currency: string | null): string {
  if (cents === null) return '—';
  return formatMoney(cents as Cents, currency || 'USD');
}

function headlineFor(upcomingCount: number, pendingCount: number): string {
  if (upcomingCount === 0 && pendingCount === 0) return 'Nothing pressing this week.';
  if (upcomingCount === 0) return 'A few small things to weigh in on.';
  if (upcomingCount === 1) return 'One charge on the way.';
  return `${upcomingCount} charges on the way.`;
}

function subFor(upcomingCount: number, pendingCount: number, accountCount: number): string {
  if (accountCount === 0 && upcomingCount === 0 && pendingCount === 0) {
    return 'No accounts synced yet — connect one in settings whenever you like.';
  }
  const bits: string[] = [];
  if (upcomingCount > 0) {
    bits.push(`${upcomingCount} autopay${upcomingCount === 1 ? '' : 's'} in the next two weeks`);
  }
  if (pendingCount > 0) {
    bits.push(`${pendingCount} small thing${pendingCount === 1 ? '' : 's'} to decide`);
  }
  if (accountCount > 0 && bits.length === 0) {
    bits.push(`${accountCount} account${accountCount === 1 ? '' : 's'} quiet for now`);
  }
  return bits.length > 0 ? `${bits.join(' · ')}.` : 'Quiet on all fronts.';
}

export default async function FinancialDashboardPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));

  // Calm denied state rather than a broken page.
  if (!hasFinancialRead(grants)) {
    return (
      <div className="mx-auto flex w-full max-w-[980px] flex-col px-10 pt-9 pb-20">
        <PageHeader
          eyebrow={
            <span className="inline-flex items-center gap-2">
              <SegDot segment="financial" size={8} />
              <span>Money</span>
            </span>
          }
          title="Tucked away."
          sub="You don't have access to the money segment in this household. Ask an admin if that's not right."
        />
      </div>
    );
  }

  const [accounts, alerts, suggestions, summaries, subscriptions] = await Promise.all([
    listAccounts({ householdId: ctx.household.id }, { grants }),
    listFinancialAlerts({ householdId: ctx.household.id, limit: 20 }, { grants }),
    listFinancialSuggestions({ householdId: ctx.household.id }, { grants }),
    listFinancialSummaries({ householdId: ctx.household.id, limit: 3 }, { grants }),
    listSubscriptions({ householdId: ctx.household.id }, { grants }),
  ]);

  const activeAlerts = alerts.filter(
    (a) => a.dismissedAt === null && (a.severity === 'critical' || a.severity === 'warn'),
  );
  const latestSummary = summaries[0] ?? null;

  const upcoming = subscriptions
    .map((s) => ({ sub: s, days: daysUntil(s.nextChargeAt) }))
    .filter(
      (s): s is { sub: (typeof subscriptions)[number]; days: number } =>
        s.days !== null && s.days >= 0 && s.days <= 14,
    )
    .sort((a, b) => a.days - b.days)
    .slice(0, 6);

  const pendingLooks = suggestions.slice(0, LOOKS_LIMIT);

  // Running totals: real balances, rolled up by kind. Matches the
  // "snapshot FactList" slot in the design without inventing numbers.
  const totalsByKind = new Map<string, { cents: number; currency: string; count: number }>();
  for (const a of accounts) {
    const cents = a.balanceCents ?? 0;
    const prev = totalsByKind.get(a.kind);
    totalsByKind.set(a.kind, {
      cents: (prev?.cents ?? 0) + cents,
      currency: a.currency || prev?.currency || 'USD',
      count: (prev?.count ?? 0) + 1,
    });
  }
  const totalsItems = Array.from(totalsByKind.entries()).map(([kind, v]) => ({
    k: kind.replace(/_/g, ' '),
    v: (
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-fg">{money(v.cents, v.currency)}</span>
        <span className="font-mono text-[11px] text-fg-muted">
          {v.count} account{v.count === 1 ? '' : 's'}
        </span>
      </span>
    ),
  }));

  const rememberItems: { k: React.ReactNode; v: React.ReactNode }[] = [];
  if (latestSummary) {
    rememberItems.push({
      k: latestSummary.period === 'week' ? 'this week' : 'this month',
      v: (
        <span className="flex items-baseline justify-between gap-3">
          <span>covers {formatRange(latestSummary.coveredStart, latestSummary.coveredEnd)}</span>
          <Link
            href="/financial/summaries"
            className="font-mono text-[11px] text-fg-muted hover:text-fg"
          >
            open →
          </Link>
        </span>
      ),
    });
  }
  for (const a of activeAlerts.slice(0, 3)) {
    rememberItems.push({
      k: a.severity === 'critical' ? 'heads up' : 'worth noticing',
      v: (
        <span>
          <span className="text-fg">{a.title}</span>
          {a.body ? <span className="text-fg-muted"> · {a.body}</span> : null}
        </span>
      ),
    });
  }
  if (accounts.length === 0) {
    rememberItems.push({
      k: 'no accounts yet',
      v: (
        <span>
          <Link
            href="/settings/connections"
            className="text-fg underline decoration-border underline-offset-2 hover:decoration-fg"
          >
            connect YNAB or Plaid
          </Link>{' '}
          to let money flow in here.
        </span>
      ),
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-[980px] flex-col px-10 pt-9 pb-20">
      <FinancialRealtimeRefresher householdId={ctx.household.id} />

      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <SegDot segment="financial" size={8} />
            <span>Money</span>
          </span>
        }
        title={headlineFor(upcoming.length, pendingLooks.length)}
        sub={subFor(upcoming.length, pendingLooks.length, accounts.length)}
      />

      {/* Worth a look */}
      <div className="mb-11">
        <SectionHead
          sub={
            pendingLooks.length === 0
              ? 'nothing urgent'
              : `${pendingLooks.length} small thing${pendingLooks.length === 1 ? '' : 's'}`
          }
        >
          Worth a look
        </SectionHead>
        {pendingLooks.length === 0 ? (
          <EmptyCard>Nothing waiting on you. We&apos;ll surface things as they come up.</EmptyCard>
        ) : (
          <div className="flex flex-col gap-3">
            {pendingLooks.map((s) => (
              <LookCard
                key={s.id}
                segment="financial"
                title={s.title}
                body={s.rationale}
                primaryAction={
                  <Link href="/financial/subscriptions" className="no-underline">
                    <WarmButton variant="primary" size="sm">
                      Open
                    </WarmButton>
                  </Link>
                }
                secondaryAction={
                  <Link href="/suggestions" className="no-underline">
                    <WarmButton variant="quiet" size="sm">
                      Later
                    </WarmButton>
                  </Link>
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Warm two-column grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <SectionHead sub="next 14 days">Coming up</SectionHead>
          {upcoming.length === 0 ? (
            <EmptyCard>Nothing projected in the next two weeks.</EmptyCard>
          ) : (
            <div className="overflow-hidden rounded-md border border-border bg-surface shadow-card">
              {upcoming.map(({ sub, days }, i) => (
                <div
                  key={sub.id}
                  className="grid grid-cols-[56px_1fr_auto] items-baseline gap-3 px-[18px] py-[13px]"
                  style={{ borderTop: i === 0 ? 'none' : '1px solid var(--color-border)' }}
                >
                  <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-fg-muted">
                    {whenLabel(days)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[14px] text-fg">{sub.canonicalName}</div>
                    <div className="mt-0.5 text-[12px] text-fg-muted">{sub.cadence}</div>
                  </div>
                  <span className="font-mono text-[12px] tabular-nums text-fg">
                    {money(sub.priceCents, sub.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <SectionHead sub="running totals">Where things stand</SectionHead>
          {totalsItems.length === 0 ? (
            <EmptyCard>
              <Link
                href="/settings/connections"
                className="text-fg underline decoration-border underline-offset-2 hover:decoration-fg"
              >
                Connect an account
              </Link>{' '}
              to see balances here.
            </EmptyCard>
          ) : (
            <FactList items={totalsItems} keyWidth={120} />
          )}
        </div>
      </div>

      {/* Things the house remembers */}
      {rememberItems.length > 0 ? (
        <div className="mt-11">
          <SectionHead>Things the house remembers</SectionHead>
          <FactList items={rememberItems} keyWidth={160} />
        </div>
      ) : null}

      {/* Quiet footer */}
      <footer className="mt-12 flex items-center gap-4 border-t border-border pt-5 font-mono text-[11px] tracking-[0.02em] text-fg-muted">
        <span>
          money · {accounts.length} account{accounts.length === 1 ? '' : 's'}
        </span>
        <span aria-hidden="true">·</span>
        <Link href="/financial/accounts" className="text-fg-muted hover:text-fg">
          all accounts →
        </Link>
        <div className="flex-1" />
        <Link href="/financial/summaries" className="text-fg-muted hover:text-fg">
          summaries →
        </Link>
      </footer>
    </div>
  );
}

/* ── Empty-state card (mirrors dashboard) ──────────────────────── */

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-surface px-5 py-5 text-[13.5px] leading-[1.55] text-fg-muted shadow-card">
      {children}
    </div>
  );
}
