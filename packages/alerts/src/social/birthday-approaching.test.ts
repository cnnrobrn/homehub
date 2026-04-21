import { describe, expect, it } from 'vitest';

import { detectBirthdayApproaching } from './birthday-approaching.js';
import { type SocialEvent, type SocialSuggestionSnapshot } from './types.js';

const HOUSEHOLD = 'h-1';
const PERSON = 'p-1';

function ev(overrides: Partial<SocialEvent> = {}): SocialEvent {
  return {
    id: 'e-1',
    household_id: HOUSEHOLD,
    kind: 'birthday',
    title: "Priya's birthday",
    starts_at: '2026-04-25T00:00:00Z',
    all_day: true,
    metadata: { subject_node_id: PERSON },
    ...overrides,
  };
}

function sugg(overrides: Partial<SocialSuggestionSnapshot> = {}): SocialSuggestionSnapshot {
  return {
    id: 's-1',
    household_id: HOUSEHOLD,
    segment: 'social',
    kind: 'reach_out_gift',
    status: 'pending',
    created_at: '2026-04-20T00:00:00Z',
    preview: { person_node_id: PERSON },
    ...overrides,
  };
}

describe('detectBirthdayApproaching', () => {
  const now = new Date('2026-04-20T00:00:00Z');

  it('emits warn when birthday is within 7 days and no suggestion exists', () => {
    const out = detectBirthdayApproaching({
      householdId: HOUSEHOLD,
      events: [ev()],
      existingSuggestions: [],
      now,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe('warn');
    expect(out[0]!.kind).toBe('birthday_approaching');
    expect(out[0]!.dedupeKey).toBe(`${PERSON}-2026`);
    expect(out[0]!.context.days_away).toBe(5);
  });

  it('suppresses when a pending reach_out_gift suggestion already references the person', () => {
    const out = detectBirthdayApproaching({
      householdId: HOUSEHOLD,
      events: [ev()],
      existingSuggestions: [sugg()],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('ignores past birthdays', () => {
    const out = detectBirthdayApproaching({
      householdId: HOUSEHOLD,
      events: [ev({ starts_at: '2026-04-15T00:00:00Z' })],
      existingSuggestions: [],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('ignores birthdays outside the 7-day window', () => {
    const out = detectBirthdayApproaching({
      householdId: HOUSEHOLD,
      events: [ev({ starts_at: '2026-05-10T00:00:00Z' })],
      existingSuggestions: [],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('ignores other households', () => {
    const out = detectBirthdayApproaching({
      householdId: HOUSEHOLD,
      events: [ev({ household_id: 'other' })],
      existingSuggestions: [],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('skips events lacking subject_node_id metadata', () => {
    const out = detectBirthdayApproaching({
      householdId: HOUSEHOLD,
      events: [ev({ metadata: {} })],
      existingSuggestions: [],
      now,
    });
    expect(out).toHaveLength(0);
  });
});
