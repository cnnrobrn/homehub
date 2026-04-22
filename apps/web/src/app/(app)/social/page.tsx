/**
 * `/social` — People segment landing ("V2 Indie").
 *
 * Same gentle shape as the other segment landings:
 *   1. PageHeader — people-dot eyebrow + first-person headline + sub.
 *   2. Threads worth tending — up to two suggestion-backed LookCards.
 *   3. Warm two-column grid — upcoming birthdays + social events on
 *      the left, people the household tracks on the right.
 *   4. "Things the house remembers" — FactList of the latest summary
 *      + any active alerts.
 *   5. Gentle footer.
 *
 * Data comes from the existing grant-aware readers. A member without
 * `social:read` sees a calm denied card.
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
import { BirthdayCountdown } from '@/components/social/BirthdayCountdown';
import { SocialRealtimeRefresher } from '@/components/social/SocialRealtimeRefresher';
import { getHouseholdContext } from '@/lib/auth/context';
import { listEvents } from '@/lib/events/listEvents';
import {
  hasSocialRead,
  listPersons,
  listSocialAlerts,
  listSocialSuggestions,
  listSocialSummaries,
  type SegmentGrant,
} from '@/lib/social';

const LOOKS_LIMIT = 2;
const UPCOMING_WINDOW_DAYS = 45;

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

function formatDay(iso: string): string {
  return new Date(iso)
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    .toLowerCase();
}

function headlineFor(birthdayCount: number, eventCount: number, pendingCount: number): string {
  if (birthdayCount === 0 && eventCount === 0 && pendingCount === 0) {
    return 'A quiet stretch of days.';
  }
  if (birthdayCount === 1) return 'A birthday soon.';
  if (birthdayCount > 1) return `${birthdayCount} birthdays on the way.`;
  if (eventCount > 0) return 'A few things with people this month.';
  return 'A handful of small threads to tend.';
}

function subFor(
  birthdayCount: number,
  eventCount: number,
  pendingCount: number,
  peopleCount: number,
): string {
  if (birthdayCount === 0 && eventCount === 0 && pendingCount === 0 && peopleCount === 0) {
    return 'Add people you care about, and reminders will land gently here.';
  }
  const bits: string[] = [];
  if (birthdayCount > 0) {
    bits.push(`${birthdayCount} birthday${birthdayCount === 1 ? '' : 's'} in the next 45 days`);
  }
  if (eventCount > 0 && birthdayCount === 0) {
    bits.push(`${eventCount} thing${eventCount === 1 ? '' : 's'} with people`);
  }
  if (pendingCount > 0) {
    bits.push(`${pendingCount} small question${pendingCount === 1 ? '' : 's'}`);
  }
  if (bits.length === 0 && peopleCount > 0) {
    bits.push(`${peopleCount} ${peopleCount === 1 ? 'person' : 'people'} the house tracks`);
  }
  return bits.length > 0 ? `${bits.join(' · ')}.` : 'Quiet on all fronts.';
}

export default async function SocialDashboardPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));
  const eventsGrants = ctx.grants.map((g) => ({
    segment: g.segment as 'financial' | 'food' | 'fun' | 'social' | 'system',
    access: g.access,
  }));

  if (!hasSocialRead(grants)) {
    return (
      <div className="mx-auto flex w-full max-w-[980px] flex-col px-10 pt-9 pb-20">
        <PageHeader
          eyebrow={
            <span className="inline-flex items-center gap-2">
              <SegDot segment="social" size={8} />
              <span>People</span>
            </span>
          }
          title="Tucked away."
          sub="You don't have access to the people segment in this household. Ask an admin if that's not right."
        />
      </div>
    );
  }

  const now = new Date();
  const horizon = new Date(now.getTime() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [alerts, suggestions, summaries, events, people] = await Promise.all([
    listSocialAlerts({ householdId: ctx.household.id, limit: 20 }, { grants }),
    listSocialSuggestions({ householdId: ctx.household.id, limit: 5 }, { grants }),
    listSocialSummaries({ householdId: ctx.household.id, limit: 2 }, { grants }),
    listEvents(
      {
        householdId: ctx.household.id,
        from: now.toISOString(),
        to: horizon.toISOString(),
        segments: ['social'],
      },
      { grants: eventsGrants },
    ),
    listPersons({ householdId: ctx.household.id, limit: 8 }, { grants }),
  ]);

  const birthdays = events.filter((e) => e.kind === 'birthday');
  const otherSocialEvents = events.filter((e) => e.kind !== 'birthday');
  const activeAlerts = alerts.filter((a) => a.dismissedAt === null);
  const latestSummary = summaries[0] ?? null;
  const pendingLooks = suggestions.slice(0, LOOKS_LIMIT);

  // Left column: birthdays first, then a small tail of other social
  // events within the same window. Keeps the list feeling like a
  // timeline rather than a duplicated "birthdays" card.
  const upcoming = [
    ...birthdays.slice(0, 5).map((e) => ({ ...e, isBirthday: true })),
    ...otherSocialEvents.slice(0, 3).map((e) => ({ ...e, isBirthday: false })),
  ]
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .slice(0, 8);

  const peopleItems = people.slice(0, 8).map((p) => ({
    k: p.relationship ?? 'person',
    v: (
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-fg">{p.canonicalName}</span>
        {p.pendingAlertCount > 0 ? (
          <span className="font-mono text-[11px] text-fg-muted">
            {p.pendingAlertCount} note{p.pendingAlertCount === 1 ? '' : 's'}
          </span>
        ) : null}
      </span>
    ),
  }));

  const rememberItems: { k: React.ReactNode; v: React.ReactNode }[] = [];
  if (latestSummary) {
    rememberItems.push({
      k: latestSummary.period === 'weekly' ? 'this week' : 'this month',
      v: (
        <span className="flex items-baseline justify-between gap-3">
          <span>covers {formatRange(latestSummary.coveredStart, latestSummary.coveredEnd)}</span>
          <Link
            href="/social/summaries"
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

  return (
    <div className="mx-auto flex w-full max-w-[980px] flex-col px-10 pt-9 pb-20">
      <SocialRealtimeRefresher householdId={ctx.household.id} />

      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <SegDot segment="social" size={8} />
            <span>People</span>
          </span>
        }
        title={headlineFor(birthdays.length, otherSocialEvents.length, pendingLooks.length)}
        sub={subFor(birthdays.length, otherSocialEvents.length, pendingLooks.length, people.length)}
      />

      {/* Threads worth tending */}
      <div className="mb-11">
        <SectionHead
          sub={
            pendingLooks.length === 0
              ? 'nothing urgent'
              : `${pendingLooks.length} small thing${pendingLooks.length === 1 ? '' : 's'}`
          }
        >
          Threads worth tending
        </SectionHead>
        {pendingLooks.length === 0 ? (
          <EmptyCard>Nothing waiting on you. We&apos;ll surface things as they come up.</EmptyCard>
        ) : (
          <div className="flex flex-col gap-3">
            {pendingLooks.map((s) => (
              <LookCard
                key={s.id}
                segment="social"
                title={s.title}
                body={s.rationale}
                primaryAction={
                  <Link href="/suggestions" className="no-underline">
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
          <SectionHead sub={`next ${UPCOMING_WINDOW_DAYS} days`}>Coming up</SectionHead>
          {upcoming.length === 0 ? (
            <EmptyCard>Nothing on the horizon. A good sign.</EmptyCard>
          ) : (
            <div className="overflow-hidden rounded-md border border-border bg-surface shadow-card">
              {upcoming.map((e, i) => (
                <div
                  key={e.id}
                  className="grid grid-cols-[72px_1fr_auto] items-baseline gap-3 px-[18px] py-[13px]"
                  style={{ borderTop: i === 0 ? 'none' : '1px solid var(--color-border)' }}
                >
                  <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-fg-muted">
                    {formatDay(e.startsAt)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[14px] text-fg">{e.title}</div>
                    {e.location ? (
                      <div className="mt-0.5 text-[12px] text-fg-muted">{e.location}</div>
                    ) : null}
                  </div>
                  {e.isBirthday ? (
                    <BirthdayCountdown startsAt={e.startsAt} />
                  ) : (
                    <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-fg-muted">
                      {e.kind}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <SectionHead sub="the house tracks">People</SectionHead>
          {peopleItems.length === 0 ? (
            <EmptyCard>
              No people yet.{' '}
              <Link
                href="/social/people"
                className="text-fg underline decoration-border underline-offset-2 hover:decoration-fg"
              >
                Add someone
              </Link>{' '}
              to start a thread.
            </EmptyCard>
          ) : (
            <FactList items={peopleItems} keyWidth={110} />
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
          people · {people.length} {people.length === 1 ? 'person' : 'people'}
        </span>
        <span aria-hidden="true">·</span>
        <Link href="/social/people" className="text-fg-muted hover:text-fg">
          all people →
        </Link>
        <div className="flex-1" />
        <Link href="/social/calendar" className="text-fg-muted hover:text-fg">
          calendar →
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
