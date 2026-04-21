/**
 * `<GroupList />` — list of household groups.
 */

import Link from 'next/link';

import type { GroupListRow } from '@/lib/social';

export interface GroupListProps {
  groups: GroupListRow[];
}

export function GroupList({ groups }: GroupListProps) {
  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
        No groups yet. Groups collect people you track together — a friend family, a book club, a
        kid&apos;s team.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
      {groups.map((g) => (
        <li key={g.id} className="flex items-center justify-between gap-3 p-3 text-sm">
          <div>
            <Link
              href={`/social/groups/${g.id}`}
              className="font-medium text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {g.canonicalName}
            </Link>
            <p className="text-xs text-fg-muted">
              {g.memberCount} member{g.memberCount === 1 ? '' : 's'}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
