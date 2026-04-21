import { describe, expect, it } from 'vitest';

import { generateGiftIdea } from './gift-idea.js';
import { type SocialEventRow, type SocialFactRow, type SocialPersonRow } from './types.js';

const HOUSEHOLD = 'h-1';
const PERSON = 'p-1';

function fact(predicate: string, value: unknown, id: string): SocialFactRow {
  return {
    id,
    household_id: HOUSEHOLD,
    subject_node_id: PERSON,
    predicate,
    object_value: value,
    object_node_id: null,
    valid_to: null,
    superseded_at: null,
    recorded_at: '2026-03-01T00:00:00Z',
  };
}

function bday(id: string, startsAt: string): SocialEventRow {
  return {
    id,
    household_id: HOUSEHOLD,
    kind: 'birthday',
    title: "Priya's birthday",
    starts_at: startsAt,
    all_day: true,
    metadata: { subject_node_id: PERSON },
  };
}

function person(): SocialPersonRow {
  return {
    id: PERSON,
    household_id: HOUSEHOLD,
    canonical_name: 'Priya',
    metadata: {},
    created_at: '2025-01-01T00:00:00Z',
  };
}

describe('generateGiftIdea', () => {
  const now = new Date('2026-04-20T00:00:00Z');

  it('emits a gift idea for a birthday within the window', async () => {
    const out = await generateGiftIdea({
      householdId: HOUSEHOLD,
      events: [bday('e-1', '2026-04-25T00:00:00Z')],
      facts: [fact('prefers', 'hiking', 'f-1'), fact('interested_in', 'bread-making', 'f-2')],
      people: [person()],
      now,
    });
    expect(out).toHaveLength(1);
    const preview = out[0]!.preview;
    expect(preview.person_node_id).toBe(PERSON);
    expect(preview.ideas).toBeInstanceOf(Array);
    expect((preview.ideas as string[]).some((s) => s.includes('hiking'))).toBe(true);
    expect(out[0]!.dedupeKey).toBe(`gift_idea:${PERSON}:2026`);
  });

  it('filters out avoided topics', async () => {
    const out = await generateGiftIdea({
      householdId: HOUSEHOLD,
      events: [bday('e-1', '2026-04-25T00:00:00Z')],
      facts: [fact('prefers', 'chocolate', 'f-1'), fact('avoids', 'chocolate', 'f-2')],
      people: [person()],
      now,
    });
    expect(out).toHaveLength(1);
    const ideas = out[0]!.preview.ideas as string[];
    expect(ideas.some((s) => s.toLowerCase().includes('chocolate'))).toBe(false);
  });

  it('falls back to generic ideas when no preference facts exist', async () => {
    const out = await generateGiftIdea({
      householdId: HOUSEHOLD,
      events: [bday('e-1', '2026-04-25T00:00:00Z')],
      facts: [],
      people: [person()],
      now,
    });
    expect(out).toHaveLength(1);
    expect((out[0]!.preview.ideas as string[]).length).toBe(3);
  });

  it('ignores birthdays outside the window', async () => {
    const out = await generateGiftIdea({
      householdId: HOUSEHOLD,
      events: [bday('e-1', '2026-06-01T00:00:00Z')],
      facts: [],
      people: [person()],
      now,
    });
    expect(out).toHaveLength(0);
  });
});
