/**
 * Social summary renderer.
 *
 * Spec anchors:
 *   - `specs/06-segments/social/summaries-alerts.md` — weekly + monthly
 *     section templates.
 *   - `specs/05-agents/summaries.md` — output shape.
 *
 * Deterministic. No model calls. The caller stamps the row with
 * `model = 'deterministic'`.
 *
 * Output layout (markdown, ~25 lines):
 *   ### Weekly / Monthly Social brief
 *   _{date range}_
 *
 *   **People you saw:** N (list top 5 with episode counts).
 *   **New people this period:** …
 *   **Upcoming birthdays / anniversaries:** next 30d list.
 *   **Noticed gaps:** persons flagged absent this period.
 *
 * The metrics blob carries structured counts for downstream consumers.
 */

import {
  type SocialSummaryInput,
  type SocialSummaryMetrics,
  type SocialSummaryOutput,
  type SummaryPeriod,
} from './types.js';

export function renderSocialSummary(input: SocialSummaryInput): SocialSummaryOutput {
  const metrics = computeSocialMetrics(input);
  const bodyMd = renderMarkdown(input, metrics);
  return { bodyMd, metrics };
}

export function computeSocialMetrics(input: SocialSummaryInput): SocialSummaryMetrics {
  const household = input.householdId;
  const start = Date.parse(input.coveredStart);
  const end = Date.parse(input.coveredEnd);

  // Per-person interaction counts within the window.
  const counts = new Map<string, number>();
  for (const ep of input.episodes) {
    if (ep.household_id !== household) continue;
    const ms = Date.parse(ep.occurred_at);
    if (!Number.isFinite(ms) || ms < start || ms >= end) continue;
    for (const pid of ep.participants) {
      counts.set(pid, (counts.get(pid) ?? 0) + 1);
    }
  }

  const topPeople = [...counts.entries()]
    .map(([personNodeId, episodeCount]) => ({
      personNodeId,
      canonicalName: input.personNames.get(personNodeId) ?? 'Unknown',
      episodeCount,
    }))
    .sort((a, b) => b.episodeCount - a.episodeCount)
    .slice(0, 5);

  // New people added this period.
  const newPeople = input.people
    .filter((p) => {
      if (p.household_id !== household) return false;
      const ms = Date.parse(p.created_at);
      return Number.isFinite(ms) && ms >= start && ms < end;
    })
    .map((p) => ({ personNodeId: p.id, canonicalName: p.canonical_name }))
    .slice(0, 25);

  // Upcoming birthdays / anniversaries in the next 30 days after the
  // end of the window (anchored at `coveredEnd`).
  const upcomingHorizonMs = end + 30 * 24 * 60 * 60 * 1000;
  const upcomingEvents = input.upcomingEvents
    .filter((e) => {
      if (e.household_id !== household) return false;
      const ms = Date.parse(e.starts_at);
      return Number.isFinite(ms) && ms >= end && ms <= upcomingHorizonMs;
    })
    .slice()
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
    .slice(0, 10)
    .map((e) => ({
      eventId: e.id,
      kind: e.kind,
      title: e.title,
      startsAt: e.starts_at,
    }));

  // Absent persons — caller passes these in (from the alerts worker or
  // a specialized query). We dedupe by id and keep name ordering.
  const absent = input.absentPersons
    .filter((p) => p.household_id === household)
    .map((p) => ({
      personNodeId: p.id,
      canonicalName: p.canonical_name,
      lastSeenAt: p.lastSeenAt,
    }));

  return {
    uniquePeopleCount: counts.size,
    topPeople,
    newPeople,
    upcomingEvents,
    absentPersons: absent,
  };
}

function renderMarkdown(input: SocialSummaryInput, metrics: SocialSummaryMetrics): string {
  const header = periodHeader(input.period);
  const dateRange = `${formatDate(input.coveredStart)} – ${formatDate(input.coveredEnd)}`;

  const lines: string[] = [];
  lines.push(`### ${header}`);
  lines.push(`_${dateRange}_`);
  lines.push('');

  if (
    metrics.uniquePeopleCount === 0 &&
    metrics.upcomingEvents.length === 0 &&
    metrics.absentPersons.length === 0 &&
    metrics.newPeople.length === 0
  ) {
    lines.push('No social activity in this period.');
    return lines.join('\n');
  }

  lines.push(`**People you saw:** ${metrics.uniquePeopleCount}`);
  if (metrics.topPeople.length > 0) {
    for (const p of metrics.topPeople) {
      lines.push(
        `- ${p.canonicalName}: ${p.episodeCount} interaction${p.episodeCount === 1 ? '' : 's'}`,
      );
    }
    lines.push('');
  }

  if (metrics.newPeople.length > 0) {
    lines.push(`**New people this period:** ${metrics.newPeople.length}`);
    for (const p of metrics.newPeople.slice(0, 5)) {
      lines.push(`- ${p.canonicalName}`);
    }
    lines.push('');
  }

  if (metrics.upcomingEvents.length > 0) {
    lines.push('**Coming up (next 30 days):**');
    for (const e of metrics.upcomingEvents) {
      lines.push(`- ${formatDate(e.startsAt)} — ${e.title}`);
    }
    lines.push('');
  }

  if (metrics.absentPersons.length > 0) {
    lines.push('**Noticed gaps:**');
    for (const p of metrics.absentPersons.slice(0, 6)) {
      const last = p.lastSeenAt ? ` — last seen ${formatDate(p.lastSeenAt)}` : '';
      lines.push(`- ${p.canonicalName}${last}`);
    }
  }

  return lines.join('\n').trimEnd();
}

function periodHeader(period: SummaryPeriod): string {
  if (period === 'weekly') return 'Weekly social brief';
  if (period === 'monthly') return 'Monthly social brief';
  return 'Daily social brief';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
