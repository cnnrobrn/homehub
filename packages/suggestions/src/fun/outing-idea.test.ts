/**
 * Unit tests for `generateOutingIdea`.
 */

import { describe, expect, it } from 'vitest';

import {
  FREE_WINDOW_LOOKAHEAD_DAYS,
  generateOutingIdea,
  type OutingIdeaPreferencePlace,
} from './outing-idea.js';

const HOUSEHOLD = 'h-1';

function pref(overrides: Partial<OutingIdeaPreferencePlace> = {}): OutingIdeaPreferencePlace {
  return {
    id: 'place-1',
    name: 'Maison',
    category: 'restaurant',
    attendedCount: 5,
    ...overrides,
  };
}

describe('generateOutingIdea', () => {
  const now = new Date('2026-04-22T12:00:00Z');

  it('emits outing ideas for free windows with preferences', () => {
    const out = generateOutingIdea({
      householdId: HOUSEHOLD,
      now,
      events: [],
      preferences: [pref()],
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]!.kind).toBe('outing_idea');
    expect(out[0]!.segment).toBe('fun');
    expect(out[0]!.preview.place_node_id).toBe('place-1');
  });

  it('returns nothing when no preferences exist', () => {
    const out = generateOutingIdea({
      householdId: HOUSEHOLD,
      now,
      events: [],
      preferences: [],
    });
    expect(out).toHaveLength(0);
  });

  it('respects the maxSuggestions cap', () => {
    const out = generateOutingIdea({
      householdId: HOUSEHOLD,
      now,
      events: [],
      preferences: [
        pref({ id: 'p1', name: 'One' }),
        pref({ id: 'p2', name: 'Two' }),
        pref({ id: 'p3', name: 'Three' }),
        pref({ id: 'p4', name: 'Four' }),
      ],
      maxSuggestions: 2,
    });
    expect(out).toHaveLength(2);
  });

  it('prefers weekend windows', () => {
    // 2026-04-22 is Wednesday (UTC). Weekend is Sat 2026-04-25.
    const out = generateOutingIdea({
      householdId: HOUSEHOLD,
      now,
      events: [],
      preferences: [pref()],
      maxSuggestions: 1,
    });
    expect(out[0]!.preview.is_weekend).toBe(true);
  });

  it('honors the lookahead window by not emitting windows beyond it', () => {
    // Fully booked lookahead → no free window.
    const endOfHorizon = new Date(
      now.getTime() + FREE_WINDOW_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const out = generateOutingIdea({
      householdId: HOUSEHOLD,
      now,
      events: [{ starts_at: now.toISOString(), ends_at: endOfHorizon, segment: 'fun' }],
      preferences: [pref()],
    });
    expect(out).toHaveLength(0);
  });

  it('dedupe keys are stable for same (window, idea) pair', () => {
    const a = generateOutingIdea({
      householdId: HOUSEHOLD,
      now,
      events: [],
      preferences: [pref()],
    });
    const b = generateOutingIdea({
      householdId: HOUSEHOLD,
      now,
      events: [],
      preferences: [pref()],
    });
    expect(a[0]!.dedupeKey).toBe(b[0]!.dedupeKey);
  });

  it('ignores non-fun/non-social events when computing free windows', () => {
    const out = generateOutingIdea({
      householdId: HOUSEHOLD,
      now,
      events: [
        {
          // A financial calendar event (autopay) shouldn't block a fun outing.
          starts_at: now.toISOString(),
          ends_at: new Date(
            now.getTime() + FREE_WINDOW_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000,
          ).toISOString(),
          segment: 'financial',
        },
      ],
      preferences: [pref()],
    });
    expect(out.length).toBeGreaterThan(0);
  });
});
