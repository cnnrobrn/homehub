/**
 * `<PersonDetail />` — full render of a single person's social view.
 */

import Link from 'next/link';

import { BirthdayCountdown } from './BirthdayCountdown';
import { ReciprocityCard } from './ReciprocityCard';

import type { PersonDetail } from '@/lib/social';

export interface PersonDetailProps {
  detail: PersonDetail;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function PersonDetail({ detail }: PersonDetailProps) {
  const { person, documentMd, facts, episodes, upcomingEvents, suggestions, reciprocity } = detail;

  const preferences = facts.filter(
    (f) => f.predicate === 'prefers' || f.predicate === 'interested_in',
  );
  const avoids = facts.filter((f) => f.predicate === 'avoids');

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{person.canonicalName}</h1>
          <Link
            href={`/memory/person/${person.id}`}
            className="text-xs text-accent underline underline-offset-2 hover:no-underline"
          >
            Open full memory record
          </Link>
        </div>
        {person.relationship ? (
          <p className="text-sm text-fg-muted">{person.relationship}</p>
        ) : null}
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ReciprocityCard
          weHosted={reciprocity.weHosted}
          hostedUs={reciprocity.hostedUs}
          totalEpisodes={reciprocity.totalEpisodes}
        />
        <div className="rounded-lg border border-border bg-surface p-4 text-sm">
          <h3 className="text-xs uppercase tracking-wide text-fg-muted">Upcoming</h3>
          {upcomingEvents.length === 0 ? (
            <p className="mt-1 text-fg-muted">
              Nothing on the calendar for {person.canonicalName}.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {upcomingEvents.slice(0, 5).map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2">
                  <span className="text-fg">{e.title}</span>
                  {e.kind === 'birthday' ? (
                    <BirthdayCountdown startsAt={e.startsAt} />
                  ) : (
                    <span className="text-xs text-fg-muted">{formatDate(e.startsAt)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 text-sm">
          <h3 className="text-xs uppercase tracking-wide text-fg-muted">Pending suggestions</h3>
          {suggestions.length === 0 ? (
            <p className="mt-1 text-fg-muted">Nothing waiting.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {suggestions.slice(0, 5).map((s) => (
                <li key={s.id} className="flex flex-col">
                  <span className="font-medium text-fg">{s.title}</span>
                  <span className="text-xs text-fg-muted">{s.rationale}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {documentMd ? (
        <section aria-label="What we know">
          <h2 className="text-sm font-semibold text-fg">What we know</h2>
          <article className="mt-2 rounded-md border border-border bg-surface p-4 text-sm leading-6">
            <pre className="whitespace-pre-wrap font-sans">{documentMd}</pre>
          </article>
        </section>
      ) : null}

      <section aria-label="Preferences" className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-4 text-sm">
          <h3 className="text-xs uppercase tracking-wide text-fg-muted">Likes</h3>
          {preferences.length === 0 ? (
            <p className="mt-1 text-fg-muted">No preferences recorded yet.</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2">
              {preferences.map((f) => (
                <li
                  key={f.id}
                  className="rounded-full border border-border bg-bg px-2 py-0.5 text-xs text-fg"
                >
                  {String(f.objectValue)}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 text-sm">
          <h3 className="text-xs uppercase tracking-wide text-fg-muted">Avoids</h3>
          {avoids.length === 0 ? (
            <p className="mt-1 text-fg-muted">No avoid flags recorded.</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2">
              {avoids.map((f) => (
                <li
                  key={f.id}
                  className="rounded-full border border-danger/40 bg-danger/5 px-2 py-0.5 text-xs text-danger"
                >
                  {String(f.objectValue)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-label="Recent episodes">
        <h2 className="text-sm font-semibold text-fg">Recent episodes</h2>
        {episodes.length === 0 ? (
          <p className="mt-2 text-sm text-fg-muted">No episodes recorded yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface">
            {episodes.slice(0, 10).map((e) => (
              <li key={e.id} className="flex flex-col p-3 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-fg">{e.title}</span>
                  <span className="text-xs text-fg-muted">{formatDate(e.occurredAt)}</span>
                </div>
                {e.summary ? <p className="mt-1 text-xs text-fg-muted">{e.summary}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
