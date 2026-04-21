/**
 * `/suggestions` — unified suggestion inbox.
 *
 * Server Component. Lists pending + recently-resolved suggestions
 * across every segment for the current household, with filters for
 * segment + kind + status. Each row renders a `SuggestionApprovalPill`
 * (Approve / Reject + quorum progress) and an evidence drawer.
 *
 * Filters are URL-encoded so the server render is deterministic:
 *   ?segment=financial&kind=cancel_subscription&status=pending
 *
 * A realtime refresher subscribes to `app.suggestion` + `app.action`
 * filtered by household so approvals by other members update
 * immediately without a manual reload.
 */

import { SuggestionListRow } from '@/components/suggestions/SuggestionListRow';
import { SuggestionsRealtimeRefresher } from '@/components/suggestions/SuggestionsRealtimeRefresher';
import { requireHouseholdContext } from '@/lib/auth/context';
import {
  listPendingSuggestions,
  listRecentSuggestions,
  type SuggestionSegment,
  type SuggestionRowView,
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

function isSegment(x: string | undefined): x is SuggestionSegment {
  return !!x && (SEGMENTS as readonly string[]).includes(x);
}

function isResolvedStatus(x: string | undefined): x is (typeof RESOLVED_STATUSES)[number] {
  return !!x && (RESOLVED_STATUSES as readonly string[]).includes(x);
}

export default async function SuggestionsPage({ searchParams }: PageProps) {
  const ctx = await requireHouseholdContext();
  const params = await searchParams;

  const segmentFilter = isSegment(params.segment) ? params.segment : undefined;
  const kindFilter = params.kind && params.kind.length > 0 ? params.kind : undefined;
  const statusFilter =
    params.status === 'pending' || isResolvedStatus(params.status) ? params.status : 'pending';

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
      // Also pull a small recent list for context.
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

  const activeFilters = [
    segmentFilter ? `segment=${segmentFilter}` : null,
    kindFilter ? `kind=${kindFilter}` : null,
    statusFilter && statusFilter !== 'pending' ? `status=${statusFilter}` : null,
  ].filter((x): x is string => x !== null);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <SuggestionsRealtimeRefresher householdId={ctx.household.id} />
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Suggestions</h1>
        <p className="text-sm text-fg-muted">
          Proposed actions from HomeHub. Approve to execute; reject to discard.
        </p>
      </header>

      {/* Filters — server-rendered via URL params so deep-links work. */}
      <section aria-label="Filters" className="flex flex-col gap-3">
        <form className="flex flex-wrap items-end gap-3" method="GET" action="/suggestions">
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            Segment
            <select
              name="segment"
              defaultValue={segmentFilter ?? ''}
              className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-fg"
            >
              <option value="">All</option>
              {SEGMENTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            Kind
            <input
              name="kind"
              defaultValue={kindFilter ?? ''}
              placeholder="e.g. cancel_subscription"
              className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-fg"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            Status
            <select
              name="status"
              defaultValue={statusFilter}
              className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-fg"
            >
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="executed">Executed</option>
              <option value="expired">Expired</option>
            </select>
          </label>
          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent/90"
          >
            Filter
          </button>
          {activeFilters.length > 0 ? (
            <a
              href="/suggestions"
              className="text-xs text-fg-muted underline-offset-2 hover:underline"
            >
              Clear
            </a>
          ) : null}
        </form>
      </section>

      {loadError ? (
        <div
          role="alert"
          className="rounded-md border border-danger/50 bg-danger/5 p-3 text-sm text-danger"
        >
          Failed to load suggestions: {loadError}
        </div>
      ) : null}

      {statusFilter === 'pending' ? (
        <section aria-labelledby="pending-heading" className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <h2 id="pending-heading" className="text-lg font-medium">
              Pending ({pending.length})
            </h2>
          </div>
          {pending.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
              No pending suggestions.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {pending.map((s) => (
                <SuggestionListRow key={s.id} suggestion={s} />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {statusFilter !== 'pending' || recent.length > 0 ? (
        <section aria-labelledby="recent-heading" className="flex flex-col gap-2">
          <h2 id="recent-heading" className="text-lg font-medium">
            {statusFilter === 'pending'
              ? 'Recently approved'
              : `${statusFilter[0]!.toUpperCase()}${statusFilter.slice(1)}`}{' '}
            ({recent.length})
          </h2>
          {recent.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
              Nothing to show.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {recent.map((s) => (
                <SuggestionListRow key={s.id} suggestion={s} />
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
