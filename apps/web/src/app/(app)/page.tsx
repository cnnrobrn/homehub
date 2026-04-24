/**
 * `/` — Today (authenticated dashboard).
 *
 * V2 Indie direction: warm, first-person, calm. Layout follows the
 * Claude Design handoff:
 *
 *  1. Greeting — date + "Morning, {name}." + gentle context sub-line.
 *  2. Today — a single unified list of today's events (unifiedish
 *     calendar: all segments threaded together by start time).
 *  3. Worth a look — at most three pending suggestions as LookCards,
 *     each stamped with its segment stripe.
 *  4. Rest of the week + Coming up — two side-by-side lists.
 *  5. Quiet footer — status chip with "quietly caught up" voice.
 *
 * Data comes from the same helpers the rest of the app uses
 * (`listEvents`, `listPendingSuggestions`) so the surface is real even
 * when M0 fixtures are thin. Empty data blocks stay quiet until there
 * is real data or Alfred setup context to populate them.
 */

import Link from 'next/link';

import { listMembersAction } from '@/app/actions/members';
import { RealtimeEventRefresher } from '@/components/calendar/RealtimeEventRefresher';
import { Eyebrow, LookCard, SegDot, WarmButton } from '@/components/design-system';
import { type SegmentId } from '@/components/design-system/segment';
import { ASSISTANT_NAME } from '@/lib/assistant';
import { getHouseholdContext } from '@/lib/auth/context';
import { listEvents, type CalendarEventRow, type Segment } from '@/lib/events/listEvents';
import { endOfToday, startOfToday } from '@/lib/events/range';
import { SETUP_SECTIONS, buildAlfredSetupPrompt, chatPromptHref } from '@/lib/onboarding/setup';
import { listPendingSuggestions, type SuggestionRowView } from '@/lib/suggestions';

const WEEK_LIMIT = 40;
const LOOKS_LIMIT = 3;

function firstName(name: string | null | undefined): string {
  if (!name) return 'there';
  const trimmed = name.trim();
  if (!trimmed) return 'there';
  const space = trimmed.indexOf(' ');
  return space === -1 ? trimmed : trimmed.slice(0, space);
}

function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  if (h < 21) return 'Evening';
  return 'Late evening';
}

function formatHeaderDate(date: Date): string {
  const weekday = date.toLocaleDateString(undefined, { weekday: 'long' });
  const monthDay = date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  return `${weekday} · ${monthDay}`;
}

function formatTime(iso: string, allDay: boolean): string {
  if (allDay) return 'all day';
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function isAppSegment(s: string): s is SegmentId {
  return s === 'financial' || s === 'food' || s === 'fun' || s === 'social';
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short' }).toLowerCase();
}

export default async function DashboardPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const grants = ctx.grants.map((g) => ({ segment: g.segment as Segment, access: g.access }));
  const now = new Date();
  const from = startOfToday();
  const to = endOfToday();
  const todayEvents = await listEvents(
    { householdId: ctx.household.id, from: from.toISOString(), to: to.toISOString(), limit: 20 },
    { grants },
  );

  const weekEnd = new Date(to);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEvents = await listEvents(
    {
      householdId: ctx.household.id,
      from: to.toISOString(),
      to: weekEnd.toISOString(),
      limit: WEEK_LIMIT,
    },
    { grants },
  );

  const pendingRaw = await listPendingSuggestions({
    householdId: ctx.household.id,
    limit: LOOKS_LIMIT,
  });
  const pending: SuggestionRowView[] = pendingRaw.slice(0, LOOKS_LIMIT);

  const membersRes = await listMembersAction({ householdId: ctx.household.id });
  const members = membersRes.ok ? membersRes.data : [];
  const me = members.find((m) => m.id === ctx.member.id) ?? null;
  const hasDashboardContent = todayEvents.length > 0 || pending.length > 0 || weekEvents.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-[980px] flex-col px-10 pt-9 pb-20">
      <RealtimeEventRefresher householdId={ctx.household.id} />

      {/* Greeting */}
      <header className="mb-9">
        <div className="mb-3.5 font-mono text-[11px] tracking-[0.04em] text-fg-muted">
          {formatHeaderDate(now)}
        </div>
        <h1 className="m-0 max-w-[640px] text-[34px] font-semibold leading-[1.15] tracking-[-0.03em] text-balance">
          {greetingFor(now)}, {firstName(me?.displayName ?? null)}.
        </h1>
        <GreetingSub todayCount={todayEvents.length} pendingCount={pending.length} />
      </header>

      {todayEvents.length > 0 ? (
        <>
          <SectionHead>Today</SectionHead>
          <TodayCard events={todayEvents} />
        </>
      ) : null}

      {/* Worth a look */}
      {pending.length > 0 ? (
        <div className="mt-11">
          <SectionHead sub={`${pending.length} small thing${pending.length === 1 ? '' : 's'}`}>
            Worth a look
          </SectionHead>
          <div className="flex flex-col gap-3">
            {pending.map((s) => (
              <PendingLookCard key={s.id} s={s} />
            ))}
          </div>
        </div>
      ) : null}

      {/* Rest of the week + Coming up */}
      {weekEvents.length > 0 ? (
        <div className="mt-11 grid grid-cols-1 gap-5 md:grid-cols-2">
          <div>
            <SectionHead>The rest of the week</SectionHead>
            <WeekCard events={weekEvents} />
          </div>
          <div>
            <SectionHead>Coming up</SectionHead>
            <ComingUpCard events={weekEvents} />
          </div>
        </div>
      ) : null}

      {!hasDashboardContent ? <AlfredSetupStart householdName={ctx.household.name} /> : null}

      {/* Quiet footer */}
      <footer className="mt-12 flex items-center gap-4 border-t border-border pt-5 font-mono text-[11px] tracking-[0.02em] text-fg-muted">
        <span>quietly caught up</span>
        <span aria-hidden="true">·</span>
        <span>{pending.length === 0 ? 'nothing urgent' : 'three small things to decide'}</span>
        <div className="flex-1" />
        <Link href="/chat" className="text-fg-muted transition-colors hover:text-fg">
          open {ASSISTANT_NAME} →
        </Link>
      </footer>
    </div>
  );
}

/* ── Greeting sub-copy ─────────────────────────────────────────── */

function GreetingSub({ todayCount, pendingCount }: { todayCount: number; pendingCount: number }) {
  let line: string;
  if (todayCount === 0 && pendingCount === 0) {
    line = 'Quiet day. Nothing on the calendar and nothing waiting for you.';
  } else if (todayCount === 0) {
    line = `Calendar’s quiet today. There ${pendingCount === 1 ? 'is' : 'are'} ${pendingCount} small thing${pendingCount === 1 ? '' : 's'} for you to weigh in on.`;
  } else if (pendingCount === 0) {
    line = `${todayCount} thing${todayCount === 1 ? '' : 's'} on today. Nothing else to decide.`;
  } else {
    line = `${todayCount} thing${todayCount === 1 ? '' : 's'} on today and ${pendingCount} small ${pendingCount === 1 ? 'question' : 'questions'} for you to weigh in on.`;
  }
  return (
    <p className="mt-3.5 max-w-[560px] text-[17px] leading-[1.55] text-fg-muted text-pretty">
      {line}
    </p>
  );
}

/* ── Section head (mono uppercase) ─────────────────────────────── */

function SectionHead({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-3.5 flex items-baseline gap-2.5">
      <h2 className="m-0 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-fg">
        {children}
      </h2>
      {sub ? <Eyebrow>· {sub}</Eyebrow> : null}
    </div>
  );
}

/* ── Today — a single grouped card with one row per event ──────── */

function TodayCard({ events }: { events: readonly CalendarEventRow[] }) {
  return (
    <div className="overflow-hidden rounded-[6px] border border-border bg-surface shadow-card">
      {events.map((ev, i) => (
        <div
          key={ev.id}
          className="grid grid-cols-[72px_1fr] items-baseline gap-4 px-5 py-4"
          style={{ borderTop: i === 0 ? 'none' : '1px solid var(--color-border)' }}
        >
          <div className="font-mono text-[12px] tracking-[0.04em] text-fg-muted">
            {formatTime(ev.startsAt, ev.allDay)}
          </div>
          <div>
            <div className="flex items-center gap-2 text-[15px] font-medium tracking-[-0.015em] text-fg">
              {isAppSegment(ev.segment) ? <SegDot segment={ev.segment} size={6} /> : null}
              <span>{ev.title}</span>
            </div>
            {ev.location ? (
              <div className="mt-0.5 text-[13px] leading-[1.5] text-fg-muted">{ev.location}</div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Worth a look — map a pending suggestion to a LookCard ─────── */

function PendingLookCard({ s }: { s: SuggestionRowView }) {
  // Suggestions may land under `system` which the app renders as
  // segment-neutral. LookCard wants one of the four ink segments; fall
  // back to `social` (neutral-blue) when system shows up.
  const seg: SegmentId = isAppSegment(s.segment) ? s.segment : 'social';
  return (
    <LookCard
      segment={seg}
      title={s.title}
      body={s.rationale}
      primaryAction={
        <Link href={`/suggestions`} className="no-underline">
          <WarmButton variant="primary" size="sm">
            Open
          </WarmButton>
        </Link>
      }
      secondaryAction={
        <Link href={`/suggestions`} className="no-underline">
          <WarmButton variant="quiet" size="sm">
            Later
          </WarmButton>
        </Link>
      }
    />
  );
}

/* ── Rest of the week ──────────────────────────────────────────── */

function WeekCard({ events }: { events: readonly CalendarEventRow[] }) {
  const slice = events.slice(0, 8);
  return (
    <div className="overflow-hidden rounded-[6px] border border-border bg-surface">
      {slice.map((ev, i) => (
        <div
          key={ev.id}
          className="grid grid-cols-[48px_1fr_auto] items-center gap-3 px-[18px] py-3"
          style={{ borderTop: i === 0 ? 'none' : '1px solid var(--color-border)' }}
        >
          <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-fg-muted">
            {dayKey(ev.startsAt)}
          </span>
          <span className="truncate text-[13.5px] text-fg">{ev.title}</span>
          {isAppSegment(ev.segment) ? <SegDot segment={ev.segment} size={6} /> : <span />}
        </div>
      ))}
    </div>
  );
}

/* ── Coming up — all-day + multi-day standouts from the week ──── */

function ComingUpCard({ events }: { events: readonly CalendarEventRow[] }) {
  // "Coming up" surfaces the all-day / noteworthy events — birthdays,
  // trips, group plans. When all-day events don't exist in the dataset
  // yet, fall back to the tail of the week so the slot isn't empty.
  const notable = events.filter((e) => e.allDay).slice(0, 4);
  const fallback = events.slice(-4);
  const picks = notable.length > 0 ? notable : fallback;

  const today = new Date();
  return (
    <div className="overflow-hidden rounded-[6px] border border-border bg-surface">
      {picks.map((ev, i) => {
        const when = new Date(ev.startsAt);
        const days = Math.max(0, Math.round((when.getTime() - today.getTime()) / 86_400_000));
        const whenLabel = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
        return (
          <div
            key={ev.id}
            className="px-[18px] py-3.5"
            style={{ borderTop: i === 0 ? 'none' : '1px solid var(--color-border)' }}
          >
            <div className="mb-0.5 flex items-baseline gap-2.5">
              <span className="text-[14px] font-medium tracking-[-0.015em] text-fg">
                {ev.title}
              </span>
              <div className="flex-1" />
              <span className="font-mono text-[11px] text-fg-muted">{whenLabel}</span>
            </div>
            {ev.location ? (
              <div className="text-[12.5px] leading-[1.5] text-fg-muted">{ev.location}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* ── First-run empty state ─────────────────────────────────────── */

function AlfredSetupStart({ householdName }: { householdName: string }) {
  const prompts = SETUP_SECTIONS.map((section) => {
    const prompt =
      buildAlfredSetupPrompt({
        householdName,
        selectedSegmentIds: [section.id],
        selectedPromptIds: section.prompts.map((item) => item.id),
      }) ?? `Alfred, help me set up ${section.title}.`;
    return { section, prompt };
  });

  return (
    <section className="mt-2 border-y border-border py-7">
      <SectionHead>Start with {ASSISTANT_NAME}</SectionHead>
      <p className="m-0 max-w-[560px] text-[14px] leading-[1.6] text-fg-muted">
        Nothing has been added yet. Pick an area and {ASSISTANT_NAME} will ask for the details
        needed to populate it.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {prompts.map(({ section, prompt }) => (
          <Link
            key={section.id}
            href={chatPromptHref(prompt)}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-[12px] text-fg-muted no-underline transition-colors hover:bg-surface-soft hover:text-fg"
          >
            <SegDot segment={section.id} size={7} />
            Set up {section.title}
          </Link>
        ))}
      </div>
    </section>
  );
}
