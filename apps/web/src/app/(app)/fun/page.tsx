/**
 * `/fun` — Fun segment landing ("V2 Indie").
 *
 * Same gentle shape as the other segment landings:
 *   1. PageHeader — fun-dot eyebrow + first-person headline + sub.
 *   2. Worth a look — up to two suggestion-backed LookCards stamped
 *      with the fun (magenta) accent stripe.
 *   3. Warm two-column grid — "Coming up" upcoming trips on the left,
 *      "What's out there" (queued ideas + alerts) on the right.
 *   4. "Things the house remembers" — FactList of the latest summary
 *      and any additional alerts.
 *   5. Gentle footer.
 *
 * Data comes from the existing grant-aware readers. A member without
 * `fun:read` sees a calm denied card.
 */

import Link from 'next/link';

import {
  FactList,
  LookCard,
  PageHeader,
  SectionHead,
  SegDot,
  WarmButton,
} from '@/components/design-system';
import { FunRealtimeRefresher } from '@/components/fun/FunRealtimeRefresher';
import { getHouseholdContext } from '@/lib/auth/context';
import {
  hasFunRead,
  listFunAlerts,
  listFunSuggestions,
  listFunSummaries,
  listQueueItems,
  listTrips,
  type SegmentGrant,
} from '@/lib/fun';

const LOOKS_LIMIT = 2;
const MS_PER_DAY = 86_400_000;

function daysUntil(iso: string): number {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / MS_PER_DAY);
}

function whenLabel(iso: string): string {
  const days = daysUntil(iso);
  if (days < 0) return 'in progress';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 7) return `in ${days} days`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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

function headlineFor(tripCount: number, queueCount: number, pendingCount: number): string {
  if (tripCount === 0 && queueCount === 0 && pendingCount === 0) return 'Nothing on the horizon.';
  if (tripCount === 1) return 'One trip on the horizon.';
  if (tripCount > 1) return `${tripCount} trips on the horizon.`;
  if (queueCount > 0) return 'A few things worth making time for.';
  return 'A quiet week with some ideas kicking around.';
}

function subFor(tripCount: number, queueCount: number, pendingCount: number): string {
  if (tripCount === 0 && queueCount === 0 && pendingCount === 0) {
    return 'Log a trip or an idea whenever something sparks.';
  }
  const bits: string[] = [];
  if (tripCount > 0) {
    bits.push(`${tripCount} trip${tripCount === 1 ? '' : 's'} upcoming`);
  }
  if (queueCount > 0) {
    bits.push(`${queueCount} thing${queueCount === 1 ? '' : 's'} in the queue`);
  }
  if (pendingCount > 0) {
    bits.push(`${pendingCount} small question${pendingCount === 1 ? '' : 's'}`);
  }
  return bits.length > 0 ? `${bits.join(' · ')}.` : 'Quiet on all fronts.';
}

export default async function FunDashboardPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));

  if (!hasFunRead(grants)) {
    return (
      <div className="mx-auto flex w-full max-w-[980px] flex-col px-10 pt-9 pb-20">
        <PageHeader
          eyebrow={
            <span className="inline-flex items-center gap-2">
              <SegDot segment="fun" size={8} />
              <span>Fun</span>
            </span>
          }
          title="Tucked away."
          sub="You don't have access to the fun segment in this household. Ask an admin if that's not right."
        />
      </div>
    );
  }

  const [trips, alerts, suggestions, summaries, queue] = await Promise.all([
    listTrips({ householdId: ctx.household.id, limit: 6 }, { grants }),
    listFunAlerts({ householdId: ctx.household.id, limit: 10 }, { grants }),
    listFunSuggestions({ householdId: ctx.household.id, limit: 6 }, { grants }),
    listFunSummaries({ householdId: ctx.household.id, limit: 1 }, { grants }),
    listQueueItems({ householdId: ctx.household.id, limit: 6 }, { grants }),
  ]);

  const activeAlerts = alerts.filter(
    (a) => a.dismissedAt === null && (a.severity === 'critical' || a.severity === 'warn'),
  );
  const latestSummary = summaries[0] ?? null;
  const pendingLooks = suggestions.slice(0, LOOKS_LIMIT);

  const queueItems = queue.slice(0, 6).map((q) => ({
    k: q.subcategory ?? 'idea',
    v: <span className="text-fg">{q.title}</span>,
  }));

  const rememberItems: { k: React.ReactNode; v: React.ReactNode }[] = [];
  if (latestSummary) {
    rememberItems.push({
      k: latestSummary.period === 'weekly' ? 'this week' : 'this month',
      v: (
        <span className="flex items-baseline justify-between gap-3">
          <span>covers {formatRange(latestSummary.coveredStart, latestSummary.coveredEnd)}</span>
          <Link href="/fun/summaries" className="font-mono text-[11px] text-fg-muted hover:text-fg">
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

  return (
    <div className="mx-auto flex w-full max-w-[980px] flex-col px-10 pt-9 pb-20">
      <FunRealtimeRefresher householdId={ctx.household.id} />

      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <SegDot segment="fun" size={8} />
            <span>Fun</span>
          </span>
        }
        title={headlineFor(trips.length, queue.length, pendingLooks.length)}
        sub={subFor(trips.length, queue.length, pendingLooks.length)}
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
          Things you&apos;ve been meaning to
        </SectionHead>
        {pendingLooks.length === 0 ? (
          <EmptyCard>Nothing waiting on you. Add to the queue whenever something sparks.</EmptyCard>
        ) : (
          <div className="flex flex-col gap-3">
            {pendingLooks.map((s) => (
              <LookCard
                key={s.id}
                segment="fun"
                title={s.title}
                body={s.rationale}
                primaryAction={
                  <Link href="/fun/queue" className="no-underline">
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
          <SectionHead sub="upcoming trips">Coming up</SectionHead>
          {trips.length === 0 ? (
            <EmptyCard>
              No trips on the books.{' '}
              <Link
                href="/fun/trips"
                className="text-fg underline decoration-border underline-offset-2 hover:decoration-fg"
              >
                Plan one
              </Link>{' '}
              when you&apos;re ready.
            </EmptyCard>
          ) : (
            <div className="overflow-hidden rounded-md border border-border bg-surface shadow-card">
              {trips.map((t, i) => (
                <div
                  key={t.id}
                  className="grid grid-cols-[72px_1fr] items-baseline gap-3 px-[18px] py-[13px]"
                  style={{ borderTop: i === 0 ? 'none' : '1px solid var(--color-border)' }}
                >
                  <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-fg-muted">
                    {whenLabel(t.startsAt)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[14px] text-fg">{t.title}</div>
                    <div className="mt-0.5 text-[12px] text-fg-muted">
                      {t.location ?? 'location tbd'}
                      {t.endsAt ? ` · ${formatRange(t.startsAt, t.endsAt)}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <SectionHead sub="queue">Ideas kicking around</SectionHead>
          {queueItems.length === 0 ? (
            <EmptyCard>Nothing queued up. Add a film, a book, a place whenever.</EmptyCard>
          ) : (
            <FactList items={queueItems} keyWidth={100} />
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
          fun · {trips.length} trip{trips.length === 1 ? '' : 's'} ahead
        </span>
        <span aria-hidden="true">·</span>
        <Link href="/fun/trips" className="text-fg-muted hover:text-fg">
          all trips →
        </Link>
        <div className="flex-1" />
        <Link href="/fun/queue" className="text-fg-muted hover:text-fg">
          queue →
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
