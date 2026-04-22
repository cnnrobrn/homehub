/**
 * `/suggestions` — Decisions (approvals inbox).
 *
 * The route key stays `suggestions` for link stability, but the human
 * label throughout the UI is "Decisions" — matching the V2 Indie
 * handoff voice: "a few small things, not urgent."
 *
 * Server Component. Reads pending + recently-resolved suggestions
 * across every segment for the current household and stacks them as
 * `DecisionCard`s — one draft per row, with the originating draft
 * previewed in a soft-callout, a short "why · " rationale line, and the
 * existing approve / reject mechanics wrapped in the card's action
 * slot.
 *
 * Filters are URL-encoded (`?segment=food&status=approved`) so the
 * server render is deterministic and deep-links work without client JS.
 *
 * Realtime via `SuggestionsRealtimeRefresher` — approvals by other
 * household members update the list without a manual reload.
 */

import Link from 'next/link';

import { PageHeader, SectionHead, type SegmentId } from '@/components/design-system';
import { DecisionItem } from '@/components/suggestions/DecisionItem';
import { DecisionsFilterBar } from '@/components/suggestions/DecisionsFilterBar';
import { SuggestionsRealtimeRefresher } from '@/components/suggestions/SuggestionsRealtimeRefresher';
import { requireHouseholdContext } from '@/lib/auth/context';
import {
  listPendingSuggestions,
  listRecentSuggestions,
  type SuggestionRowView,
  type SuggestionSegment,
} from '@/lib/suggestions';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    segment?: string;
    kind?: string;
    status?: string;
  }>;
}

const SEGMENTS: readonly SuggestionSegment[] = ['financial', 'food', 'fun', 'social', 'system'];
const RESOLVED_STATUSES = ['approved', 'rejected', 'executed', 'expired'] as const;
const APP_SEGMENTS: readonly SegmentId[] = ['financial', 'food', 'fun', 'social'];

function isSegment(x: string | undefined): x is SuggestionSegment {
  return !!x && (SEGMENTS as readonly string[]).includes(x);
}

function isAppSegment(x: SuggestionSegment | undefined | null): x is SegmentId {
  return !!x && (APP_SEGMENTS as readonly string[]).includes(x);
}

function isResolvedStatus(x: string | undefined): x is (typeof RESOLVED_STATUSES)[number] {
  return !!x && (RESOLVED_STATUSES as readonly string[]).includes(x);
}

/**
 * Calm waiting count: "a few small things, not urgent" when we have
 * some pending rows, and a gentler line when the inbox is empty or the
 * member is browsing recently-decided items.
 */
function subCopyFor(params: {
  status: 'pending' | (typeof RESOLVED_STATUSES)[number];
  pendingCount: number;
}): string {
  if (params.status !== 'pending') {
    return 'A look at what you decided recently. Nothing here is waiting on you.';
  }
  if (params.pendingCount === 0) {
    return 'Nothing waiting on you right now. Drafts land here whenever they need a yes.';
  }
  if (params.pendingCount <= 3) {
    return 'A few small things, not urgent. Decide whenever — they wait a day or two, then quietly let go.';
  }
  return 'A handful of small things to weigh in on. None of them are urgent — take your time.';
}

export default async function SuggestionsPage({ searchParams }: PageProps) {
  const ctx = await requireHouseholdContext();
  const params = await searchParams;

  const segmentFilter = isSegment(params.segment) ? params.segment : undefined;
  const kindFilter = params.kind && params.kind.length > 0 ? params.kind : undefined;
  const statusFilter: 'pending' | (typeof RESOLVED_STATUSES)[number] =
    params.status === 'pending' || isResolvedStatus(params.status)
      ? (params.status as 'pending' | (typeof RESOLVED_STATUSES)[number])
      : 'pending';

  let pending: SuggestionRowView[] = [];
  let recent: SuggestionRowView[] = [];
  let loadError: string | null = null;

  try {
    if (statusFilter === 'pending') {
      pending = await listPendingSuggestions({
        householdId: ctx.household.id,
        ...(segmentFilter ? { segment: segmentFilter } : {}),
        ...(kindFilter ? { kind: kindFilter } : {}),
        limit: 100,
      });
      // Small recent-approved tail so the footer line has something to
      // count when the inbox is near-empty.
      recent = await listRecentSuggestions({
        householdId: ctx.household.id,
        status: 'approved',
        limit: 10,
      });
    } else if (isResolvedStatus(statusFilter)) {
      recent = await listRecentSuggestions({
        householdId: ctx.household.id,
        status: statusFilter,
        limit: 100,
      });
    }
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  const filterSegment = isAppSegment(segmentFilter) ? segmentFilter : null;
  const pendingCount = pending.length;
  const subCopy = subCopyFor({ status: statusFilter, pendingCount });
  const eyebrow =
    statusFilter === 'pending'
      ? pendingCount === 0
        ? 'nothing waiting'
        : `${pendingCount} waiting`
      : 'recently decided';

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col px-10 pt-9 pb-20">
      <SuggestionsRealtimeRefresher householdId={ctx.household.id} />

      <PageHeader eyebrow={eyebrow} title="Decisions" sub={subCopy} />

      <section aria-label="Filters" className="mb-8">
        <DecisionsFilterBar
          segment={filterSegment}
          status={statusFilter}
          kind={kindFilter ?? null}
        />
      </section>

      {loadError ? (
        <div
          role="alert"
          className="mb-6 rounded-[6px] border border-danger/40 bg-surface px-4 py-3 text-[13.5px] text-danger"
        >
          Couldn&apos;t load decisions: {loadError}
        </div>
      ) : null}

      {statusFilter === 'pending' ? (
        <section aria-labelledby="pending-heading">
          <SectionHead>
            <span id="pending-heading">Waiting on you</span>
          </SectionHead>
          {pending.length === 0 ? (
            <EmptyDecisions
              title="Nothing to decide right now."
              body="When HomeHub drafts something for you — a note to send, a subscription to sort out, a swap on the meal plan — it'll land here. Until then, it's quiet."
            />
          ) : (
            <div className="flex flex-col gap-3.5">
              {pending.map((s) => (
                <DecisionItem key={s.id} suggestion={s} />
              ))}
            </div>
          )}
        </section>
      ) : null}

      {statusFilter !== 'pending' ? (
        <section aria-labelledby="recent-heading">
          <SectionHead sub={`${recent.length}`}>
            <span id="recent-heading">
              {statusFilter === 'approved'
                ? 'Approved'
                : statusFilter === 'rejected'
                  ? 'Set aside'
                  : statusFilter === 'executed'
                    ? 'Done'
                    : 'Quietly let go'}
            </span>
          </SectionHead>
          {recent.length === 0 ? (
            <EmptyDecisions
              title="Nothing to show here."
              body="When things get decided, they land in this list so you can look back."
            />
          ) : (
            <div className="flex flex-col gap-3.5">
              {recent.map((s) => (
                <DecisionItem key={s.id} suggestion={s} />
              ))}
            </div>
          )}
        </section>
      ) : null}

      {statusFilter === 'pending' && recent.length > 0 ? (
        <footer className="mt-12 flex flex-wrap items-center gap-3 border-t border-border pt-5 font-mono text-[11px] tracking-[0.02em] text-fg-muted">
          <span>recently decided</span>
          <span aria-hidden="true">·</span>
          <span>
            {recent.length} in the last while · you said yes to{' '}
            {recent.filter((r) => r.status === 'approved' || r.status === 'executed').length}
          </span>
          <div className="flex-1" />
          <Link
            href="/suggestions?status=approved"
            className="text-fg-muted underline-offset-2 hover:text-fg hover:underline"
          >
            look back →
          </Link>
        </footer>
      ) : null}
    </div>
  );
}

/* ── Empty state — calm, lowercase-leaning ──────────────────────── */

function EmptyDecisions({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[6px] border border-border bg-surface px-5 py-7 shadow-card">
      <p className="m-0 text-[14.5px] font-medium leading-[1.4] tracking-[-0.01em] text-fg">
        {title}
      </p>
      <p className="mt-1.5 max-w-[560px] text-[13.5px] leading-[1.6] text-fg-muted">{body}</p>
    </div>
  );
}
