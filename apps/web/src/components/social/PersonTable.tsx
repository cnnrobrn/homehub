/**
 * `<PersonTable />` — person directory table.
 *
 * Server Component. Keyboard-navigable: each row is a link; the
 * browser handles focus / arrow-down-on-tab-list. Pending alert count
 * surfaces as a pip next to the name and includes an aria-label so
 * screen readers announce it.
 */

import Link from 'next/link';

import type { PersonListRow } from '@/lib/social';

export interface PersonTableProps {
  persons: PersonListRow[];
}

function formatLastSeen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const days = Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

export function PersonTable({ persons }: PersonTableProps) {
  if (persons.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
        No people tracked yet. People are added as they appear in calendar events, emails, and
        episodes.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="bg-bg/30 text-xs uppercase tracking-wide text-fg-muted">
          <tr>
            <th scope="col" className="px-4 py-2">
              Name
            </th>
            <th scope="col" className="px-4 py-2">
              Relationship
            </th>
            <th scope="col" className="px-4 py-2">
              Last seen
            </th>
            <th scope="col" className="px-4 py-2 text-right">
              Alerts
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {persons.map((p) => (
            <tr key={p.id} className="transition-colors hover:bg-bg/30 focus-within:bg-bg/30">
              <td className="px-4 py-2 font-medium text-fg">
                <Link
                  href={`/social/people/${p.id}`}
                  className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {p.canonicalName}
                </Link>
                {p.aliases.length > 0 ? (
                  <span className="ml-2 text-xs text-fg-muted">a.k.a. {p.aliases.join(', ')}</span>
                ) : null}
              </td>
              <td className="px-4 py-2 text-fg-muted">{p.relationship ?? '—'}</td>
              <td className="px-4 py-2 text-fg-muted">{formatLastSeen(p.lastSeenAt)}</td>
              <td className="px-4 py-2 text-right">
                {p.pendingAlertCount > 0 ? (
                  <span
                    aria-label={`${p.pendingAlertCount} pending alert${p.pendingAlertCount === 1 ? '' : 's'}`}
                    className="inline-flex min-w-[1.75rem] items-center justify-center rounded-full border border-warn/60 bg-warn/10 px-2 py-0.5 text-xs font-medium text-warn"
                  >
                    {p.pendingAlertCount}
                  </span>
                ) : (
                  <span className="text-xs text-fg-muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
