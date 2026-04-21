/**
 * `/social/people` — person directory.
 */

import Link from 'next/link';

import { PersonTable } from '@/components/social/PersonTable';
import { SocialRealtimeRefresher } from '@/components/social/SocialRealtimeRefresher';
import { getHouseholdContext } from '@/lib/auth/context';
import { listPersons, type SegmentGrant } from '@/lib/social';

export interface PeoplePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstString(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

export default async function PeoplePage({ searchParams }: PeoplePageProps) {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const params = await searchParams;
  const q = firstString(params.q)?.trim();

  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));

  const persons = await listPersons(
    {
      householdId: ctx.household.id,
      ...(q && q.length > 0 ? { searchText: q } : {}),
      limit: 300,
    },
    { grants },
  );

  return (
    <div className="flex flex-col gap-4">
      <SocialRealtimeRefresher householdId={ctx.household.id} />
      <form role="search" className="flex flex-wrap items-center gap-2">
        <label htmlFor="q" className="sr-only">
          Search people
        </label>
        <input
          type="search"
          name="q"
          id="q"
          defaultValue={q ?? ''}
          placeholder="Search people by name"
          className="flex-1 min-w-0 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <button
          type="submit"
          className="rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
        >
          Search
        </button>
        {q ? (
          <Link
            href="/social/people"
            className="rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
          >
            Clear
          </Link>
        ) : null}
      </form>
      <PersonTable persons={persons} />
    </div>
  );
}
