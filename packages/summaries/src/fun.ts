/**
 * Fun summary renderer.
 *
 * Spec: `specs/06-segments/fun/summaries-alerts.md` — weekly and
 * monthly digests of what the household did.
 *
 * Output: deterministic markdown with
 *   - Headline count + unique places.
 *   - Top activities by kind.
 *   - Upcoming events preview.
 *
 * Returns both a markdown body and a structured metrics blob the web
 * app can render without re-parsing.
 */

import { type HouseholdId } from '@homehub/shared';

import { type SummaryPeriod } from './types.js';

export interface FunEventRow {
  id: string;
  household_id: string;
  segment: string;
  kind: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  metadata: Record<string, unknown>;
}

export interface FunSummaryInput {
  householdId: HouseholdId;
  period: SummaryPeriod;
  coveredStart: string;
  coveredEnd: string;
  /** Events inside the covered window (already filtered). */
  events: FunEventRow[];
  /** Upcoming events for the preview section. */
  upcomingEvents: FunEventRow[];
  /** Optional "now" override for deterministic formatting. */
  now?: Date;
}

export interface FunSummaryMetrics {
  eventCount: number;
  uniquePlaces: number;
  topKinds: Array<{ kind: string; count: number }>;
  totalHours: number;
  upcomingEventCount: number;
  trips: Array<{ id: string; title: string; startsAt: string }>;
}

export interface FunSummaryOutput {
  bodyMd: string;
  metrics: FunSummaryMetrics;
}

export function renderFunSummary(input: FunSummaryInput): FunSummaryOutput {
  const metrics = computeFunMetrics(input);
  const bodyMd = renderMarkdown(input, metrics);
  return { bodyMd, metrics };
}

export function computeFunMetrics(input: FunSummaryInput): FunSummaryMetrics {
  const inHousehold = input.events.filter(
    (e) => e.household_id === input.householdId && e.segment === 'fun',
  );

  const uniqueLocations = new Set<string>();
  const kindCounts = new Map<string, number>();
  let totalMs = 0;
  const trips: Array<{ id: string; title: string; startsAt: string }> = [];

  for (const ev of inHousehold) {
    if (ev.location) uniqueLocations.add(ev.location.trim().toLowerCase());
    kindCounts.set(ev.kind, (kindCounts.get(ev.kind) ?? 0) + 1);
    const start = new Date(ev.starts_at).getTime();
    const end = ev.ends_at ? new Date(ev.ends_at).getTime() : start;
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      totalMs += end - start;
    }
    if (ev.kind === 'trip') {
      trips.push({ id: ev.id, title: ev.title, startsAt: ev.starts_at });
    }
  }

  const topKinds = [...kindCounts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    eventCount: inHousehold.length,
    uniquePlaces: uniqueLocations.size,
    topKinds,
    totalHours: Math.round((totalMs / (60 * 60 * 1000)) * 10) / 10,
    upcomingEventCount: input.upcomingEvents.filter(
      (e) => e.household_id === input.householdId && e.segment === 'fun',
    ).length,
    trips,
  };
}

function renderMarkdown(input: FunSummaryInput, metrics: FunSummaryMetrics): string {
  const header =
    input.period === 'weekly'
      ? 'Weekly fun recap'
      : input.period === 'monthly'
        ? 'Monthly fun recap'
        : 'Daily fun recap';
  const dateRange = `${formatDate(input.coveredStart)} – ${formatDate(input.coveredEnd)}`;

  const lines: string[] = [];
  lines.push(`### ${header}`);
  lines.push(`_${dateRange}_`);
  lines.push('');

  if (metrics.eventCount === 0) {
    lines.push('No fun events in this period.');
    if (metrics.upcomingEventCount > 0) {
      lines.push('');
      lines.push(`**Upcoming:** ${metrics.upcomingEventCount} event(s) on the horizon.`);
    }
    return lines.join('\n').trimEnd();
  }

  lines.push(`**Events:** ${metrics.eventCount}`);
  lines.push(`**Unique places:** ${metrics.uniquePlaces}`);
  lines.push(`**Time spent:** ${metrics.totalHours}h`);
  lines.push('');

  if (metrics.topKinds.length > 0) {
    lines.push('**Top activities:**');
    for (const { kind, count } of metrics.topKinds) {
      lines.push(`- ${kind.replace(/_/g, ' ')} — ${count}`);
    }
    lines.push('');
  }

  if (metrics.trips.length > 0) {
    lines.push('**Trips:**');
    for (const trip of metrics.trips) {
      lines.push(`- ${trip.title} (${formatDate(trip.startsAt)})`);
    }
    lines.push('');
  }

  if (metrics.upcomingEventCount > 0) {
    lines.push(`**Coming up:** ${metrics.upcomingEventCount} event(s).`);
  }

  return lines.join('\n').trimEnd();
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
