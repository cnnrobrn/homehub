import { describe, expect, it } from 'vitest';

import { detectConflictingBirthdayNoPlan } from './conflicting-birthday-no-plan.js';
import { type SocialEvent } from './types.js';

const HOUSEHOLD = 'h-1';
const PERSON = 'p-1';

function bday(overrides: Partial<SocialEvent> = {}): SocialEvent {
  return {
    id: 'bday-1',
    household_id: HOUSEHOLD,
    kind: 'birthday',
    title: "Priya's birthday",
    starts_at: '2026-04-22T00:00:00Z',
    all_day: true,
    metadata: { subject_node_id: PERSON },
    ...overrides,
  };
}

describe('detectConflictingBirthdayNoPlan', () => {
  const now = new Date('2026-04-20T00:00:00Z');
  const names = new Map([[PERSON, 'Priya']]);

  it('fires when birthday within 3 days and no plan references the person', () => {
    const out = detectConflictingBirthdayNoPlan({
      householdId: HOUSEHOLD,
      events: [bday()],
      personNames: names,
      now,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe('warn');
    expect(out[0]!.kind).toBe('conflicting_birthday_without_plan');
  });

  it('suppresses when another event references the person via metadata', () => {
    const plan: SocialEvent = {
      id: 'dinner',
      household_id: HOUSEHOLD,
      kind: 'dinner',
      title: 'Dinner out',
      starts_at: '2026-04-21T18:00:00Z',
      all_day: false,
      metadata: { related_person_node_id: PERSON },
    };
    const out = detectConflictingBirthdayNoPlan({
      householdId: HOUSEHOLD,
      events: [bday(), plan],
      personNames: names,
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('suppresses when another non-birthday event title includes the person name', () => {
    const plan: SocialEvent = {
      id: 'drinks',
      household_id: HOUSEHOLD,
      kind: 'social',
      title: 'Drinks with Priya',
      starts_at: '2026-04-22T19:00:00Z',
      all_day: false,
      metadata: {},
    };
    const out = detectConflictingBirthdayNoPlan({
      householdId: HOUSEHOLD,
      events: [bday(), plan],
      personNames: names,
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('does not fire for birthdays beyond 3 days', () => {
    const out = detectConflictingBirthdayNoPlan({
      householdId: HOUSEHOLD,
      events: [bday({ starts_at: '2026-04-28T00:00:00Z' })],
      personNames: names,
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('ignores other households', () => {
    const out = detectConflictingBirthdayNoPlan({
      householdId: HOUSEHOLD,
      events: [bday({ household_id: 'other' })],
      personNames: names,
      now,
    });
    expect(out).toHaveLength(0);
  });
});
