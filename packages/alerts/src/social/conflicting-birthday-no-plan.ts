/**
 * `conflicting_birthday_without_plan` detector.
 *
 * Premise: a birthday is within 3 days but the household has no
 * non-birthday event on the calendar marking a celebration or
 * reach-out plan for that person. Emits `warn`.
 *
 * Heuristic for "has a plan": any `app.event` where
 * `metadata.related_person_node_id === personNodeId` OR the event
 * title contains the person's canonical name AND the event kind is
 * not `birthday` / `anniversary`. Keeps the detector deterministic
 * without needing a new DB column.
 *
 * Dedupe key: `${personNodeId}-${year}-noplan`.
 */

import { type AlertEmission } from '../types.js';

import { type SocialEvent } from './types.js';

export const CONFLICTING_BIRTHDAY_WINDOW_DAYS = 3;

export interface ConflictingBirthdayNoPlanInput {
  householdId: string;
  events: SocialEvent[];
  /**
   * Map from person-node-id to canonical name. Used for the
   * title-match fallback when metadata doesn't link the event to a
   * person explicitly.
   */
  personNames: Map<string, string>;
  now: Date;
}

export function detectConflictingBirthdayNoPlan(
  input: ConflictingBirthdayNoPlanInput,
): AlertEmission[] {
  const out: AlertEmission[] = [];
  const nowMs = input.now.getTime();
  const cutoffMs = nowMs + CONFLICTING_BIRTHDAY_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  // Pre-index non-birthday events by related-person id AND by lower-
  // cased title for the name fallback.
  const planPersonIds = new Set<string>();
  const planTitles: string[] = [];
  for (const e of input.events) {
    if (e.household_id !== input.householdId) continue;
    if (e.kind === 'birthday' || e.kind === 'anniversary') continue;
    const related = e.metadata['related_person_node_id'];
    if (typeof related === 'string') planPersonIds.add(related);
    planTitles.push(e.title.toLowerCase());
  }

  for (const event of input.events) {
    if (event.household_id !== input.householdId) continue;
    if (event.kind !== 'birthday') continue;
    const startMs = new Date(event.starts_at).getTime();
    if (!Number.isFinite(startMs)) continue;
    if (startMs < nowMs || startMs > cutoffMs) continue;

    const personNodeId = event.metadata['subject_node_id'];
    if (typeof personNodeId !== 'string') continue;

    if (planPersonIds.has(personNodeId)) continue;
    const canonicalName = input.personNames.get(personNodeId);
    if (canonicalName) {
      const name = canonicalName.toLowerCase();
      if (planTitles.some((t) => t.includes(name))) continue;
    }

    const year = new Date(event.starts_at).getUTCFullYear();
    const daysAway = Math.max(0, Math.round((startMs - nowMs) / (24 * 60 * 60 * 1000)));
    out.push({
      segment: 'social',
      severity: 'warn',
      kind: 'conflicting_birthday_without_plan',
      dedupeKey: `${personNodeId}-${year}-noplan`,
      title: `${event.title} is ${daysAway === 0 ? 'today' : `in ${daysAway} days`} — no plan on the calendar`,
      body: `No non-birthday event references ${canonicalName ?? 'this person'} in the coming week; nothing marks how you'll celebrate or reach out.`,
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
