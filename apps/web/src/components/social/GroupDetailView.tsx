import Link from 'next/link';

import type { GroupDetail } from '@/lib/social';

export interface GroupDetailViewProps {
  detail: GroupDetail;
}

export function GroupDetailView({ detail }: GroupDetailViewProps) {
  const { group, members, upcomingEventCount } = detail;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{group.canonicalName}</h1>
        <p className="text-sm text-fg-muted">
          {members.length} member{members.length === 1 ? '' : 's'} · {upcomingEventCount} upcoming
          event{upcomingEventCount === 1 ? '' : 's'}
        </p>
      </header>
      <section aria-labelledby="members-heading">
        <h2 id="members-heading" className="text-sm font-semibold text-fg">
          Members
        </h2>
        {members.length === 0 ? (
          <p className="mt-2 text-sm text-fg-muted">No members yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface">
            {members.map((m) => (
              <li key={m.id} className="p-3 text-sm">
                <Link
                  href={`/social/people/${m.id}`}
                  className="font-medium text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {m.canonicalName}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
