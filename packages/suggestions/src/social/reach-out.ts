/**
 * `reach_out` generator.
 *
 * Spec: `specs/06-segments/social/suggestions-coordination.md` — "Person's
 * absence threshold crossed". The alerts worker's `absence_long`
 * detector flags the person; this generator drafts a human message to
 * reach out. Deterministic candidate selection; the rationale can be
 * model-polished via a `RationaleWriter`.
 *
 * Dedupe key: `reach_out:${personNodeId}:${monthBucket}` — a single
 * reach-out per person per calendar month.
 */

import { type RationaleWriter, type SuggestionEmission } from '../types.js';

import { type AbsentPersonInfo } from './types.js';

export interface ReachOutInput {
  householdId: string;
  absent: ReadonlyArray<AbsentPersonInfo>;
  now: Date;
  maxSuggestions?: number;
}

export async function generateReachOut(
  input: ReachOutInput,
  writer?: RationaleWriter,
): Promise<SuggestionEmission[]> {
  const month = `${input.now.getUTCFullYear()}-${String(input.now.getUTCMonth() + 1).padStart(2, '0')}`;
  const max = input.maxSuggestions ?? 5;
  const out: SuggestionEmission[] = [];

  const sorted = [...input.absent].sort((a, b) => b.daysSince - a.daysSince).slice(0, max);

  for (const p of sorted) {
    const title = `Reach out to ${p.canonicalName}`;
    const fallback = `You haven't seen ${p.canonicalName} in ${p.daysSince} days — a quick message or call would keep the connection warm.`;
    const rationale = writer
      ? await writer({
          kind: 'reach_out',
          candidate: {
            person_node_id: p.personNodeId,
            canonical_name: p.canonicalName,
            days_since: p.daysSince,
            last_seen_at: p.lastSeenAt,
          },
          fallback,
        })
      : fallback;

    out.push({
      segment: 'social',
      kind: 'reach_out',
      title,
      rationale,
      preview: {
        person_node_id: p.personNodeId,
        canonical_name: p.canonicalName,
        days_since: p.daysSince,
        last_seen_at: p.lastSeenAt,
        draft_message: defaultDraft(p.canonicalName, p.daysSince),
        dedupe_key: `reach_out:${p.personNodeId}:${month}`,
      },
      dedupeKey: `reach_out:${p.personNodeId}:${month}`,
    });
  }
  return out;
}

function defaultDraft(name: string, days: number): string {
  return `Hey ${name} — realized it's been about ${days} days since we caught up. Free this week for a quick coffee or call?`;
}
