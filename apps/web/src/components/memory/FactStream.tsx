/**
 * Warm-themed stream of recently noted facts + episodes.
 *
 * Server Component. Renders each entry as a quiet card with a mono
 * timestamp and middot-separated meta ("noted apr 18 · from
 * calendar"). The style mirrors the Claude Design handoff's "what
 * we know" middle pane: journal entries, not DB rows.
 *
 * The parent resolves the subject + object node labels and passes
 * them in so this stay presentational.
 */

import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';

import type { EpisodeRow, FactRow, NodeRow } from '@/lib/memory/query';
import type { NodeType } from '@homehub/shared';

import { cn } from '@/lib/cn';

/* ── Types ────────────────────────────────────────────────────── */

export type StreamEntry =
  | { kind: 'fact'; fact: FactRow }
  | { kind: 'episode'; episode: EpisodeRow };

export interface FactStreamProps {
  entries: readonly StreamEntry[];
  /** Resolve `subject_node_id` / `object_node_id` / `place_node_id` → canonical_name + type. */
  nodeLookup: Map<string, NodeRow>;
  emptyMessage?: string;
  className?: string;
}

/* ── Formatting helpers (match the warm-theme copy conventions) ─ */

function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toLowerCase();
}

function formatObjectValue(value: FactRow['object_value']): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/* ── Fact entry ───────────────────────────────────────────────── */

function FactEntry({ fact, nodeLookup }: { fact: FactRow; nodeLookup: Map<string, NodeRow> }) {
  const subject = nodeLookup.get(fact.subject_node_id);
  const subjectLabel = subject?.canonical_name ?? 'someone';
  const objectNode = fact.object_node_id ? nodeLookup.get(fact.object_node_id) : null;
  const objectLabel = objectNode?.canonical_name ?? formatObjectValue(fact.object_value) ?? '—';
  const sourceLabel = fact.source.replace(/_/g, ' ').toLowerCase();
  const href =
    subject && (subject.type as NodeType) ? `/memory/${subject.type}/${subject.id}` : null;
  const hasConflict = fact.conflict_status !== 'none';

  const body = (
    <>
      <div className="mb-1.5 flex items-baseline gap-2.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
        <span>noted {shortDate(fact.recorded_at)}</span>
        <span aria-hidden="true">·</span>
        <span>from {sourceLabel}</span>
        {hasConflict ? (
          <>
            <span aria-hidden="true">·</span>
            <span
              role="status"
              aria-label="Conflict noted"
              className="inline-flex items-center gap-1 text-warn"
            >
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              <span>conflict</span>
            </span>
          </>
        ) : null}
      </div>
      <div className="text-[13.5px] leading-[1.55] text-fg">
        <span className="font-medium">{subjectLabel}</span>
        <span className="text-fg-muted"> · {fact.predicate} · </span>
        <span>{objectLabel}</span>
      </div>
    </>
  );

  return (
    <article
      className={cn(
        'block rounded-[6px] border border-border bg-surface px-[18px] py-3.5',
        'shadow-[0_8px_24px_-8px_rgba(0,0,0,0.06)]',
      )}
    >
      {href ? (
        <Link
          href={href as never}
          className="block no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          {body}
        </Link>
      ) : (
        body
      )}
    </article>
  );
}

/* ── Episode entry ────────────────────────────────────────────── */

function EpisodeEntry({
  episode,
  nodeLookup,
}: {
  episode: EpisodeRow;
  nodeLookup: Map<string, NodeRow>;
}) {
  const place = episode.place_node_id ? nodeLookup.get(episode.place_node_id) : null;
  const participants = episode.participants
    .map((id) => nodeLookup.get(id)?.canonical_name)
    .filter((name): name is string => Boolean(name))
    .slice(0, 3);
  const sourceLabel = episode.source_type.replace(/_/g, ' ').toLowerCase();

  return (
    <article className="block rounded-[6px] border border-border bg-surface px-[18px] py-3.5 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.06)]">
      <div className="mb-1.5 flex items-baseline gap-2.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
        <span>{shortDate(episode.occurred_at)}</span>
        <span aria-hidden="true">·</span>
        <span>from {sourceLabel}</span>
        {place ? (
          <>
            <span aria-hidden="true">·</span>
            <span>at {place.canonical_name.toLowerCase()}</span>
          </>
        ) : null}
      </div>
      <div className="text-[13.5px] leading-[1.55] text-fg">{episode.title}</div>
      {episode.summary ? (
        <div className="mt-0.5 text-[12.5px] leading-[1.5] text-fg-muted">{episode.summary}</div>
      ) : null}
      {participants.length > 0 ? (
        <div className="mt-2 font-mono text-[10.5px] tracking-[0.04em] text-fg-muted">
          with {participants.join(' · ')}
        </div>
      ) : null}
    </article>
  );
}

/* ── Stream ───────────────────────────────────────────────────── */

export function FactStream({
  entries,
  nodeLookup,
  emptyMessage = 'Nothing picked up yet. As the house listens, small things will land here.',
  className,
}: FactStreamProps) {
  if (entries.length === 0) {
    return (
      <div
        className={cn(
          'rounded-[6px] border border-border bg-surface px-[18px] py-6 text-[13.5px] leading-[1.55] text-fg-muted',
          className,
        )}
      >
        {emptyMessage}
      </div>
    );
  }
  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      {entries.map((e) =>
        e.kind === 'fact' ? (
          <FactEntry key={`f-${e.fact.id}`} fact={e.fact} nodeLookup={nodeLookup} />
        ) : (
          <EpisodeEntry key={`e-${e.episode.id}`} episode={e.episode} nodeLookup={nodeLookup} />
        ),
      )}
    </div>
  );
}
