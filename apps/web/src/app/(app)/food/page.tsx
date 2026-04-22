/**
 * `/food` — Food segment landing ("V2 Indie").
 *
 * Same gentle shape as the other segment landings:
 *   1. PageHeader — food-dot eyebrow + first-person headline + sub.
 *   2. Worth a look — up to two suggestion-backed LookCards.
 *   3. Warm two-column grid — "Next few meals" on the left, "What's on
 *      hand" (expiring soon) snapshot on the right.
 *   4. "Things the house remembers" — FactList of the latest summary +
 *      any active food alerts.
 *   5. Gentle footer.
 *
 * Data comes from the existing grant-aware readers. A member without
 * `food:read` sees a calm denied card. The realtime refresher stays
 * wired so inbound writes repaint the surface.
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
import { FoodRealtimeRefresher } from '@/components/food/FoodRealtimeRefresher';
import { getHouseholdContext } from '@/lib/auth/context';
import {
  hasFoodRead,
  listFoodAlerts,
  listFoodSuggestions,
  listFoodSummaries,
  listMeals,
  listPantryItems,
  type SegmentGrant,
} from '@/lib/food';

const LOOKS_LIMIT = 2;
const MS_PER_DAY = 86_400_000;

function next7Days(): { from: string; to: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

function dayLabel(plannedFor: string): string {
  // `plannedFor` is a date-only string ('YYYY-MM-DD'). Treating it as
  // local midnight avoids "off by one" rendering on the east side of UTC.
  const parts = plannedFor.split('-').map(Number);
  const date = new Date(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((date.getTime() - today.getTime()) / MS_PER_DAY);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return date.toLocaleDateString(undefined, { weekday: 'short' }).toLowerCase();
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

function expiryHint(iso: string | null): string {
  if (!iso) return 'expires soon';
  const parts = iso.split('-').map(Number);
  const target = new Date(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
  if (days <= 0) return 'use today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

function headlineFor(mealCount: number, expiringCount: number): string {
  if (mealCount === 0 && expiringCount === 0) return 'Kitchen is quiet.';
  if (mealCount === 0) return 'Nothing planned yet.';
  if (expiringCount > 0 && mealCount > 0) {
    return `${mealCount} meal${mealCount === 1 ? '' : 's'} planned. A few things want using.`;
  }
  return `${mealCount} meal${mealCount === 1 ? '' : 's'} on the week.`;
}

function subFor(mealCount: number, expiringCount: number, pendingCount: number): string {
  if (mealCount === 0 && expiringCount === 0 && pendingCount === 0) {
    return 'Open the planner to draft the week, or let the pantry fill itself.';
  }
  const bits: string[] = [];
  if (expiringCount > 0) {
    bits.push(`${expiringCount} thing${expiringCount === 1 ? '' : 's'} expiring soon`);
  }
  if (pendingCount > 0) {
    bits.push(`${pendingCount} small question${pendingCount === 1 ? '' : 's'}`);
  }
  if (bits.length === 0 && mealCount > 0) bits.push('pantry looks fine');
  return bits.length > 0 ? `${bits.join(' · ')}.` : 'Quiet on all fronts.';
}

export default async function FoodDashboardPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));

  if (!hasFoodRead(grants)) {
    return (
      <div className="mx-auto flex w-full max-w-[980px] flex-col px-10 pt-9 pb-20">
        <PageHeader
          eyebrow={
            <span className="inline-flex items-center gap-2">
              <SegDot segment="food" size={8} />
              <span>Food</span>
            </span>
          }
          title="Tucked away."
          sub="You don't have access to the food segment in this household. Ask an admin if that's not right."
        />
      </div>
    );
  }

  const { from, to } = next7Days();

  const [meals, pantryExpiring, alerts, suggestions, summaries] = await Promise.all([
    listMeals({ householdId: ctx.household.id, from, to }, { grants }),
    listPantryItems(
      { householdId: ctx.household.id, expiringWithinDays: 4, limit: 20 },
      { grants },
    ),
    listFoodAlerts({ householdId: ctx.household.id, limit: 10 }, { grants }),
    listFoodSuggestions({ householdId: ctx.household.id, limit: 6 }, { grants }),
    listFoodSummaries({ householdId: ctx.household.id, limit: 1 }, { grants }),
  ]);

  const activeAlerts = alerts.filter((a) => a.dismissedAt === null);
  const latestSummary = summaries[0] ?? null;
  const pendingLooks = suggestions.slice(0, LOOKS_LIMIT);

  const expiringItems = pantryExpiring.map((p) => ({
    k: p.name,
    v: (
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-fg-muted">
          {p.location ?? 'pantry'}
          {p.quantity !== null ? ` · ${p.quantity}${p.unit ? ` ${p.unit}` : ''}` : ''}
        </span>
        <span className="font-mono text-[11px] text-fg-muted">{expiryHint(p.expiresOn)}</span>
      </span>
    ),
  }));

  const rememberItems: { k: React.ReactNode; v: React.ReactNode }[] = [];
  if (latestSummary) {
    rememberItems.push({
      k:
        latestSummary.period === 'week' || latestSummary.period === 'weekly'
          ? 'this week'
          : 'this month',
      v: (
        <span className="flex items-baseline justify-between gap-3">
          <span>covers {formatRange(latestSummary.coveredStart, latestSummary.coveredEnd)}</span>
          <Link
            href="/food/summaries"
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
      <FoodRealtimeRefresher householdId={ctx.household.id} />

      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <SegDot segment="food" size={8} />
            <span>Food</span>
          </span>
        }
        title={headlineFor(meals.length, pantryExpiring.length)}
        sub={subFor(meals.length, pantryExpiring.length, pendingLooks.length)}
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
          Small things
        </SectionHead>
        {pendingLooks.length === 0 ? (
          <EmptyCard>Nothing waiting on you. We&apos;ll surface things as they come up.</EmptyCard>
        ) : (
          <div className="flex flex-col gap-3">
            {pendingLooks.map((s) => (
              <LookCard
                key={s.id}
                segment="food"
                title={s.title}
                body={s.rationale}
                primaryAction={
                  <Link href="/food/meal-planner" className="no-underline">
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
          <SectionHead sub="next 7 days">Coming up</SectionHead>
          {meals.length === 0 ? (
            <EmptyCard>
              No meals planned.{' '}
              <Link
                href="/food/meal-planner"
                className="text-fg underline decoration-border underline-offset-2 hover:decoration-fg"
              >
                Open the planner
              </Link>{' '}
              to draft the week.
            </EmptyCard>
          ) : (
            <div className="overflow-hidden rounded-md border border-border bg-surface shadow-card">
              {meals.slice(0, 8).map((m, i) => (
                <div
                  key={m.id}
                  className="grid grid-cols-[56px_1fr_auto] items-baseline gap-3 px-[18px] py-[13px]"
                  style={{ borderTop: i === 0 ? 'none' : '1px solid var(--color-border)' }}
                >
                  <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-fg-muted">
                    {dayLabel(m.plannedFor)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[14px] text-fg">{m.title}</div>
                    <div className="mt-0.5 text-[12px] text-fg-muted">
                      {m.slot}
                      {m.servings ? ` · serves ${m.servings}` : ''}
                    </div>
                  </div>
                  <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-fg-muted">
                    {m.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <SectionHead sub={expiringItems.length > 0 ? 'want using' : 'looking good'}>
            What&apos;s on hand
          </SectionHead>
          {expiringItems.length === 0 ? (
            <EmptyCard>Pantry&apos;s calm. Nothing about to turn.</EmptyCard>
          ) : (
            <FactList items={expiringItems} keyWidth={140} />
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
          food · {meals.length} meal{meals.length === 1 ? '' : 's'} on
        </span>
        <span aria-hidden="true">·</span>
        <Link href="/food/pantry" className="text-fg-muted hover:text-fg">
          pantry →
        </Link>
        <div className="flex-1" />
        <Link href="/food/meal-planner" className="text-fg-muted hover:text-fg">
          planner →
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
