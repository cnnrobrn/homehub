/**
 * `reciprocity_imbalance` detector.
 *
 * Spec: `specs/06-segments/social/summaries-alerts.md` + the hosting
 * suggestion in `suggestions-coordination.md`. The premise: if the
 * household has hosted a given person > RECIPROCITY_RATIO × the number
 * of times they hosted us in the last LOOKBACK_DAYS window, suggest
 * rebalancing. Emission is `info`.
 *
 * Classification:
 *   - "We hosted them" = the episode's `place_node_id` is in the
 *     household's home-place set.
 *   - "They hosted us" = the episode has a `place_node_id` that is NOT
 *     in the home-place set AND the person is among participants.
 *   - Episodes without a place are ignored (can't classify).
 *
 * Dedupe is `${personNodeId}-${quarter}` so re-nudges are quarterly.
 */

import { type AlertEmission } from '../types.js';

import { type HomePlaceSet, type SocialEpisode, type SocialPersonNode } from './types.js';

export const RECIPROCITY_LOOKBACK_DAYS = 180;
export const RECIPROCITY_RATIO = 2;
export const RECIPROCITY_MIN_HOSTED = 2;

export interface ReciprocityImbalanceInput {
  householdId: string;
  people: SocialPersonNode[];
  episodes: SocialEpisode[];
  homePlaces: HomePlaceSet;
  now: Date;
}

export function detectReciprocityImbalance(input: ReciprocityImbalanceInput): AlertEmission[] {
  const out: AlertEmission[] = [];
  const nowMs = input.now.getTime();
  const cutoffMs = nowMs - RECIPROCITY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  type Counts = { hostedUs: number; weHosted: number };
  const perPerson = new Map<string, Counts>();

  for (const episode of input.episodes) {
    if (episode.household_id !== input.householdId) continue;
    const occurredMs = new Date(episode.occurred_at).getTime();
    if (!Number.isFinite(occurredMs) || occurredMs < cutoffMs) continue;
    if (!episode.place_node_id) continue;
    const weHostedThis = input.homePlaces.has(episode.place_node_id);
    for (const pid of episode.participants) {
      const counts = perPerson.get(pid) ?? { hostedUs: 0, weHosted: 0 };
      if (weHostedThis) counts.weHosted += 1;
      else counts.hostedUs += 1;
      perPerson.set(pid, counts);
    }
  }

  const quarter = `${input.now.getUTCFullYear()}Q${Math.floor(input.now.getUTCMonth() / 3) + 1}`;

  for (const person of input.people) {
    if (person.household_id !== input.householdId) continue;
    if (typeof person.metadata['deleted_at'] === 'string') continue;
    const counts = perPerson.get(person.id);
    if (!counts) continue;
    if (counts.weHosted < RECIPROCITY_MIN_HOSTED) continue;

    // Imbalance: we hosted > ratio × they hosted. When they never
    // hosted us, treat that as `0` hosts — the ratio condition becomes
    // `weHosted > 0` and RECIPROCITY_MIN_HOSTED already ensures it's
    // at least `RECIPROCITY_MIN_HOSTED`.
    const imbalanced =
      counts.hostedUs === 0
        ? counts.weHosted >= RECIPROCITY_MIN_HOSTED
        : counts.weHosted > counts.hostedUs * RECIPROCITY_RATIO;

    if (!imbalanced) continue;

    out.push({
      segment: 'social',
      severity: 'info',
      kind: 'reciprocity_imbalance',
      dedupeKey: `${person.id}-${quarter}`,
      title: `You've hosted ${person.canonical_name} more than they've hosted you`,
      body: `In the last ${RECIPROCITY_LOOKBACK_DAYS} days you hosted ${counts.weHosted}× vs. ${counts.hostedUs}× the other way.`,
      context: {
        person_node_id: person.id,
        person_name: person.canonical_name,
        we_hosted: counts.weHosted,
        hosted_us: counts.hostedUs,
        lookback_days: RECIPROCITY_LOOKBACK_DAYS,
      },
    });
  }

  return out;
}
