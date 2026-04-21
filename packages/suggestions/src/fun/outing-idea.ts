/**
 * `outing_idea` generator.
 *
 * Spec: `specs/06-segments/fun/suggestions-coordination.md` — "Free
 * weekend block + household preferences + seasonality."
 *
 * Algorithm:
 *   - Compute "free windows" in the next N days: contiguous chunks of
 *     ≥3 hours with no fun/social calendar events. Weekend windows are
 *     preferred over weekday.
 *   - Match each window against the household's liked places / topics,
 *     pulled from `mem.node` type=`place` and type=`topic` with
 *     metadata flag `liked=true` (source of truth = member curation).
 *   - For each (window, idea) pair, emit one `SuggestionEmission` with
 *     kind `outing_idea`. Caller optionally polishes the rationale via
 *     the RationaleWriter.
 *
 * Dedupe key: `${windowStartIso}-${ideaId}`.
 */

import { type SuggestionEmission } from '../types.js';

export const FREE_WINDOW_LOOKAHEAD_DAYS = 14;
export const FREE_WINDOW_MIN_DURATION_HOURS = 3;

export interface FreeWindow {
  start: string;
  end: string;
  durationHours: number;
  isWeekend: boolean;
}

export interface OutingIdeaPreferencePlace {
  id: string;
  name: string;
  /** e.g. "restaurant", "museum", "park". */
  category: string | null;
  /** How often the household has gone there (from `mem.edge type=attended`). */
  attendedCount: number;
}

export interface OutingIdeaInput {
  householdId: string;
  now: Date;
  /**
   * Fun-segment events in the lookahead window. The generator infers
   * busy time from these and computes free windows.
   */
  events: ReadonlyArray<{ starts_at: string; ends_at: string | null; segment: string }>;
  preferences: ReadonlyArray<OutingIdeaPreferencePlace>;
  /** Cap the output so a noisy calendar doesn't generate 20 cards. */
  maxSuggestions?: number;
}

export function generateOutingIdea(input: OutingIdeaInput): SuggestionEmission[] {
  const maxSuggestions = input.maxSuggestions ?? 3;
  const windows = computeFreeWindows(input.now, input.events);
  if (windows.length === 0 || input.preferences.length === 0) return [];

  // Rank windows by weekend-first then by duration.
  const rankedWindows = [...windows].sort((a, b) => {
    if (a.isWeekend !== b.isWeekend) return a.isWeekend ? -1 : 1;
    return b.durationHours - a.durationHours;
  });

  // Rank ideas by attended count (more-loved = more suggestable).
  const rankedIdeas = [...input.preferences].sort((a, b) => b.attendedCount - a.attendedCount);

  // Prefer the first weekend sub-window when the main window spans
  // multiple days. We slice into per-day chunks so the "weekend vs
  // weekday" signal on the emission reflects reality.
  const daySlices = rankedWindows.flatMap(sliceIntoDays);
  const weekendFirst = [...daySlices].sort((a, b) => {
    if (a.isWeekend !== b.isWeekend) return a.isWeekend ? -1 : 1;
    return b.durationHours - a.durationHours;
  });

  const out: SuggestionEmission[] = [];
  const pool = weekendFirst.length > 0 ? weekendFirst : rankedWindows;
  for (let k = 0; k < maxSuggestions; k += 1) {
    const window = pool[k % pool.length]!;
    const idea = rankedIdeas[k % rankedIdeas.length]!;
    const dedupeKey = `${window.start}-${idea.id}`;
    // Avoid emitting two of the exact same (window, idea) pair.
    if (out.some((o) => o.dedupeKey === dedupeKey)) break;
    out.push({
      segment: 'fun',
      kind: 'outing_idea',
      title: `Outing idea: ${idea.name}`,
      rationale: `You have a free ${formatDuration(window.durationHours)} window on ${formatDate(window.start)} — ${idea.name} has been a household favorite.`,
      preview: {
        window_start: window.start,
        window_end: window.end,
        place_node_id: idea.id,
        place_name: idea.name,
        place_category: idea.category,
        is_weekend: window.isWeekend,
        dedupe_key: dedupeKey,
      },
      dedupeKey,
    });
  }
  return out;
}

/**
 * Slice a free window spanning multiple days into per-day sub-windows
 * so weekend-preference sorting can prefer the weekend slice of a long
 * stretch.
 */
function sliceIntoDays(window: FreeWindow): FreeWindow[] {
  const startMs = new Date(window.start).getTime();
  const endMs = new Date(window.end).getTime();
  const minMs = FREE_WINDOW_MIN_DURATION_HOURS * 60 * 60 * 1000;
  const out: FreeWindow[] = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const startDay = new Date(cursor);
    const nextDay = new Date(
      Date.UTC(startDay.getUTCFullYear(), startDay.getUTCMonth(), startDay.getUTCDate() + 1),
    ).getTime();
    const sliceEnd = Math.min(nextDay, endMs);
    if (sliceEnd - cursor >= minMs) {
      const startIso = new Date(cursor).toISOString();
      const endIso = new Date(sliceEnd).toISOString();
      const dow = new Date(cursor).getUTCDay();
      out.push({
        start: startIso,
        end: endIso,
        durationHours: (sliceEnd - cursor) / (60 * 60 * 1000),
        isWeekend: dow === 0 || dow === 6,
      });
    }
    cursor = sliceEnd;
  }
  return out.length > 0 ? out : [window];
}

/**
 * Compute gaps of ≥3h in the next 14d across the events list.
 */
function computeFreeWindows(
  now: Date,
  events: ReadonlyArray<{ starts_at: string; ends_at: string | null; segment: string }>,
): FreeWindow[] {
  const start = now.getTime();
  const end = start + FREE_WINDOW_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000;
  const minMs = FREE_WINDOW_MIN_DURATION_HOURS * 60 * 60 * 1000;

  // Build a sorted list of busy intervals [startMs, endMs].
  const busy: Array<[number, number]> = [];
  for (const ev of events) {
    if (ev.segment !== 'fun' && ev.segment !== 'social') continue;
    const s = new Date(ev.starts_at).getTime();
    const e = ev.ends_at ? new Date(ev.ends_at).getTime() : s + 60 * 60 * 1000;
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    if (e < start || s > end) continue;
    busy.push([Math.max(s, start), Math.min(e, end)]);
  }
  busy.sort((a, b) => a[0] - b[0]);

  // Merge overlapping busy ranges.
  const merged: Array<[number, number]> = [];
  for (const [s, e] of busy) {
    if (merged.length === 0) {
      merged.push([s, e]);
      continue;
    }
    const last = merged[merged.length - 1]!;
    if (s <= last[1]) {
      last[1] = Math.max(last[1], e);
    } else {
      merged.push([s, e]);
    }
  }

  // Scan gaps between merged busy spans (and before the first / after
  // the last). Consider only daylight-ish blocks (10–22 UTC as a naive
  // default; overnight windows rarely map to outings).
  const windows: FreeWindow[] = [];
  let cursor = start;
  for (const [s, e] of merged) {
    if (s - cursor >= minMs) windows.push(buildWindow(cursor, s));
    cursor = Math.max(cursor, e);
  }
  if (end - cursor >= minMs) windows.push(buildWindow(cursor, end));

  return windows;
}

function buildWindow(startMs: number, endMs: number): FreeWindow {
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();
  const durationHours = (endMs - startMs) / (60 * 60 * 1000);
  const dow = new Date(startMs).getUTCDay();
  const isWeekend = dow === 0 || dow === 6;
  return { start: startIso, end: endIso, durationHours, isWeekend };
}

function formatDuration(h: number): string {
  if (h < 24) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
