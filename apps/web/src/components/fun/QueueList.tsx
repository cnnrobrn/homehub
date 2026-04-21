/**
 * `<QueueList />` — books / shows / games to do list.
 */

import { type QueueItemRow } from '@/lib/fun';

export interface QueueListProps {
  items: QueueItemRow[];
}

const SUB_LABEL: Record<string, string> = {
  book: 'Book',
  show: 'Show',
  movie: 'Movie',
  game: 'Game',
  podcast: 'Podcast',
  other: 'Other',
};

export function QueueList({ items }: QueueListProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
        Nothing queued yet. Add books, shows, games, or places you want to check out.
      </div>
    );
  }

  return (
    <ul role="list" className="divide-y divide-border rounded-lg border border-border bg-surface">
      {items.map((item) => (
        <li key={item.id} className="flex items-start justify-between gap-3 p-3 text-sm">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="font-medium text-fg">{item.title}</span>
            {typeof item.metadata.note === 'string' && item.metadata.note ? (
              <span className="text-xs text-fg-muted">{item.metadata.note as string}</span>
            ) : null}
          </div>
          <span className="rounded-sm border border-border bg-bg px-2 py-0.5 text-[11px] uppercase tracking-wide text-fg-muted">
            {item.subcategory ? (SUB_LABEL[item.subcategory] ?? item.subcategory) : 'Topic'}
          </span>
        </li>
      ))}
    </ul>
  );
}
