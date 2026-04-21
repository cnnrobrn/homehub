/**
 * `birthday_approaching` detector.
 *
 * Spec: `specs/06-segments/social/summaries-alerts.md` — "upcoming
 * birthday" detector (14/7/2/1 day windows).
 *
 * Algorithm: for every `app.event` row with `kind='birthday'` whose
 * `starts_at` is within 7 days of `now` (and not in the past), emit a
 * `warn` alert unless a pending `app.suggestion` of kind
 * `reach_out_gift` already references the subject person (that means
 * the suggestions worker has already followed up — alert is
 * redundant). The dedupe key ties the alert to `(personNodeId, year)`
 * so re-runs in the same week don't spam.
 */

import { type AlertEmission } from '../types.js';

import { type SocialEvent, type SocialSuggestionSnapshot } from './types.js';

export const BIRTHDAY_APPROACHING_WINDOW_DAYS = 7;

export interface BirthdayApproachingInput {
  householdId: string;
  events: SocialEvent[];
  /**
   * Pending `reach_out_gift` suggestions. When one already references
   * the same person, we skip the alert — the next-action-owner queue
   * already has it covered.
   */
  existingSuggestions: SocialSuggestionSnapshot[];
  now: Date;
}

export function detectBirthdayApproaching(input: BirthdayApproachingInput): AlertEmission[] {
  const out: AlertEmission[] = [];
  const nowMs = input.now.getTime();
  const cutoffMs = nowMs + BIRTHDAY_APPROACHING_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const suggestedPersonIds = new Set<string>();
  for (const s of input.existingSuggestions) {
    if (s.household_id !== input.householdId) continue;
    if (s.kind !== 'reach_out_gift' && s.kind !== 'gift_idea') continue;
    if (s.status !== 'pending') continue;
    const pid = s.preview['person_node_id'];
    if (typeof pid === 'string') suggestedPersonIds.add(pid);
  }

  for (const event of input.events) {
    if (event.household_id !== input.householdId) continue;
    if (event.kind !== 'birthday') continue;
    const startMs = new Date(event.starts_at).getTime();
    if (!Number.isFinite(startMs)) continue;
    if (startMs < nowMs) continue; // already past
    if (startMs > cutoffMs) continue; // too far out

    const personNodeId = event.metadata['subject_node_id'];
    if (typeof personNodeId !== 'string') continue;
    if (suggestedPersonIds.has(personNodeId)) continue;

    const daysAway = Math.max(0, Math.round((startMs - nowMs) / (24 * 60 * 60 * 1000)));
    const year = new Date(event.starts_at).getUTCFullYear();

    out.push({
      segment: 'social',
      severity: 'warn',
      kind: 'birthday_approaching',
      dedupeKey: `${personNodeId}-${year}`,
      title: daysAway === 0 ? `${event.title} today` : `${event.title} in ${daysAway} days`,
      body: `Birthday coming up on ${formatDate(event.starts_at)} and no reach-out or gift suggestion has been drafted yet.`,
      context: {
        event_id: event.id,
        person_node_id: personNodeId,
        starts_at: event.starts_at,
        days_away: daysAway,
      },
    });
  }

  return out;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
