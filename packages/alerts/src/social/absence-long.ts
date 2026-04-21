/**
 * `absence_long` detector.
 *
 * Spec: `specs/06-segments/social/summaries-alerts.md` — "long absence".
 *
 * Algorithm: for every tracked person where the household has seen
 * >= MIN_RECENT_EPISODES interactions in the LOOKBACK window, emit an
 * `info` alert when the most recent episode is more than
 * ABSENCE_THRESHOLD_DAYS old. Dedupe is `${personNodeId}-${lastSeenMonth}`
 * so once a month we re-nudge if absence persists.
 *
 * Rationale:
 *   - "Seen frequently, then stopped" is the signal. A person you only
 *     ever saw once 70 days ago is not a long absence — they're just a
 *     one-off contact.
 *   - The "month" bucket in the dedupe key means an ongoing absence
 *     fires once per calendar month rather than every worker run.
 */

import { type AlertEmission } from '../types.js';

import { type SocialEpisode, type SocialPersonNode } from './types.js';

export const ABSENCE_LOOKBACK_DAYS = 90;
export const ABSENCE_THRESHOLD_DAYS = 60;
export const MIN_RECENT_EPISODES = 3;

export interface AbsenceLongInput {
  householdId: string;
  people: SocialPersonNode[];
  episodes: SocialEpisode[];
  now: Date;
}

export function detectAbsenceLong(input: AbsenceLongInput): AlertEmission[] {
  const out: AlertEmission[] = [];
  const nowMs = input.now.getTime();
  const lookbackCutoff = nowMs - ABSENCE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const absenceCutoff = nowMs - ABSENCE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

  // Build person -> episodes map for the lookback window.
  const personEpisodes = new Map<string, SocialEpisode[]>();
  for (const episode of input.episodes) {
    if (episode.household_id !== input.householdId) continue;
    const occurredMs = new Date(episode.occurred_at).getTime();
    if (!Number.isFinite(occurredMs)) continue;
    if (occurredMs < lookbackCutoff) continue;
    for (const pid of episode.participants) {
      const list = personEpisodes.get(pid);
      if (list) list.push(episode);
      else personEpisodes.set(pid, [episode]);
    }
  }

  for (const person of input.people) {
    if (person.household_id !== input.householdId) continue;
    // Soft-deleted nodes are ignored (metadata.deleted_at).
    if (typeof person.metadata['deleted_at'] === 'string') continue;

    const episodes = personEpisodes.get(person.id);
    if (!episodes || episodes.length < MIN_RECENT_EPISODES) continue;

    // Find the most recent episode.
    let latestMs = -Infinity;
    for (const e of episodes) {
      const ms = new Date(e.occurred_at).getTime();
      if (ms > latestMs) latestMs = ms;
    }
    if (!Number.isFinite(latestMs)) continue;
    if (latestMs >= absenceCutoff) continue; // still within fresh window

    const daysSince = Math.floor((nowMs - latestMs) / (24 * 60 * 60 * 1000));
    const lastSeen = new Date(latestMs);
    const monthBucket = `${lastSeen.getUTCFullYear()}-${String(lastSeen.getUTCMonth() + 1).padStart(2, '0')}`;

    out.push({
      segment: 'social',
      severity: 'info',
      kind: 'absence_long',
      dedupeKey: `${person.id}-${monthBucket}`,
      title: `Haven't seen ${person.canonical_name} in ${daysSince} days`,
      body: `You regularly saw ${person.canonical_name} but the last interaction was ${daysSince} days ago.`,
      context: {
        person_node_id: person.id,
        person_name: person.canonical_name,
        last_seen_at: lastSeen.toISOString(),
        recent_episode_count: episodes.length,
        days_since: daysSince,
      },
    });
  }

  return out;
}
