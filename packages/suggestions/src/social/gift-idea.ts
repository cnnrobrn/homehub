/**
 * `gift_idea` generator.
 *
 * Spec: `specs/06-segments/social/suggestions-coordination.md` — gift
 * ideas seeded from the memory graph (preferences, prior gifts,
 * avoids).
 *
 * Candidate selection is deterministic: for each upcoming birthday
 * within the configured window (default 14d), we pull the person's
 * preference facts (`prefers`, `interested_in`, `avoids`) and derive
 * up to 3 distinct ideas. If the member wants nicer copy, the caller
 * injects a `RationaleWriter` that rewrites the fallback.
 *
 * Dedupe key: `gift_idea:${personNodeId}:${year}` — one gift-idea per
 * birthday per year.
 */

import { type RationaleWriter, type SuggestionEmission } from '../types.js';

import { type SocialEventRow, type SocialFactRow, type SocialPersonRow } from './types.js';

export const GIFT_IDEA_WINDOW_DAYS = 14;
export const GIFT_IDEA_MAX_IDEAS = 3;

export interface GiftIdeaInput {
  householdId: string;
  events: SocialEventRow[];
  facts: SocialFactRow[];
  people: SocialPersonRow[];
  now: Date;
  windowDays?: number;
}

export async function generateGiftIdea(
  input: GiftIdeaInput,
  writer?: RationaleWriter,
): Promise<SuggestionEmission[]> {
  const windowDays = input.windowDays ?? GIFT_IDEA_WINDOW_DAYS;
  const nowMs = input.now.getTime();
  const horizonMs = nowMs + windowDays * 24 * 60 * 60 * 1000;

  const personById = new Map<string, SocialPersonRow>();
  for (const p of input.people) personById.set(p.id, p);

  // Build per-person preference buckets once so we can apply to all
  // events in a single pass.
  const prefsBySubject = new Map<string, { likes: string[]; avoids: string[] }>();
  for (const f of input.facts) {
    if (f.household_id !== input.householdId) continue;
    if (f.valid_to !== null || f.superseded_at !== null) continue;
    const bucket = prefsBySubject.get(f.subject_node_id) ?? { likes: [], avoids: [] };
    const v = coerceStringish(f.object_value);
    if (!v) {
      prefsBySubject.set(f.subject_node_id, bucket);
      continue;
    }
    if (f.predicate === 'prefers' || f.predicate === 'interested_in') {
      if (!bucket.likes.includes(v)) bucket.likes.push(v);
    } else if (f.predicate === 'avoids') {
      if (!bucket.avoids.includes(v)) bucket.avoids.push(v);
    }
    prefsBySubject.set(f.subject_node_id, bucket);
  }

  const out: SuggestionEmission[] = [];

  for (const event of input.events) {
    if (event.household_id !== input.householdId) continue;
    if (event.kind !== 'birthday') continue;
    const startMs = new Date(event.starts_at).getTime();
    if (!Number.isFinite(startMs) || startMs < nowMs || startMs > horizonMs) continue;

    const personNodeId = event.metadata['subject_node_id'];
    if (typeof personNodeId !== 'string') continue;
    const person = personById.get(personNodeId);
    if (!person) continue;

    const prefs = prefsBySubject.get(personNodeId) ?? { likes: [], avoids: [] };
    const ideas = buildIdeas(prefs.likes, prefs.avoids).slice(0, GIFT_IDEA_MAX_IDEAS);
    const year = new Date(event.starts_at).getUTCFullYear();
    const fallback = renderFallback(person.canonical_name, ideas);
    const rationale = writer
      ? await writer({
          kind: 'gift_idea',
          candidate: {
            person_node_id: personNodeId,
            canonical_name: person.canonical_name,
            likes: prefs.likes,
            avoids: prefs.avoids,
            ideas,
          },
          fallback,
        })
      : fallback;

    out.push({
      segment: 'social',
      kind: 'gift_idea',
      title: `Gift ideas for ${person.canonical_name}`,
      rationale,
      preview: {
        person_node_id: personNodeId,
        event_id: event.id,
        ideas,
        likes: prefs.likes,
        avoids: prefs.avoids,
        dedupe_key: `gift_idea:${personNodeId}:${year}`,
      },
      dedupeKey: `gift_idea:${personNodeId}:${year}`,
    });
  }

  return out;
}

function coerceStringish(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = (value as Record<string, unknown>)['value'];
    if (typeof v === 'string') return v.trim() || null;
  }
  return null;
}

function buildIdeas(likes: string[], avoids: string[]): string[] {
  const avoidSet = new Set(avoids.map((a) => a.toLowerCase()));
  const ideas: string[] = [];
  for (const like of likes) {
    if (avoidSet.has(like.toLowerCase())) continue;
    ideas.push(`Something related to ${like}`);
  }
  if (ideas.length === 0) {
    ideas.push('A thoughtful handwritten card with a shared memory');
    ideas.push('A book in a genre they have mentioned');
    ideas.push('A dinner or experience together');
  }
  return ideas;
}

function renderFallback(name: string, ideas: string[]): string {
  if (ideas.length === 0) {
    return `${name}'s birthday is coming up. Consider a thoughtful card or a shared experience — no explicit preferences on file yet.`;
  }
  return `${name}'s birthday is coming up. Based on what we know, here are starter ideas:\n- ${ideas.join('\n- ')}`;
}
