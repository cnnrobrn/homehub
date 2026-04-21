import { describe, expect, it } from 'vitest';

import { ABSENCE_THRESHOLD_DAYS, detectAbsenceLong } from './absence-long.js';
import { type SocialEpisode, type SocialPersonNode } from './types.js';

const HOUSEHOLD = 'h-1';
const PERSON = 'p-1';

function person(overrides: Partial<SocialPersonNode> = {}): SocialPersonNode {
  return {
    id: PERSON,
    household_id: HOUSEHOLD,
    canonical_name: 'Mom',
    metadata: {},
    needs_review: false,
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function ep(id: string, occurredAt: string, overrides: Partial<SocialEpisode> = {}): SocialEpisode {
  return {
    id,
    household_id: HOUSEHOLD,
    occurred_at: occurredAt,
    participants: [PERSON],
    place_node_id: null,
    source_type: 'event',
    metadata: {},
    ...overrides,
  };
}

describe('detectAbsenceLong', () => {
  const now = new Date('2026-04-20T00:00:00Z');

  it('emits info when a frequently-seen person has not been seen in >60 days', () => {
    const out = detectAbsenceLong({
      householdId: HOUSEHOLD,
      people: [person()],
      episodes: [
        ep('e-1', '2026-01-25T00:00:00Z'),
        ep('e-2', '2026-02-05T00:00:00Z'),
        ep('e-3', '2026-02-15T00:00:00Z'), // ~64 days ago
      ],
      now,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe('info');
    expect(out[0]!.kind).toBe('absence_long');
    expect(out[0]!.dedupeKey).toContain(PERSON);
  });

  it('does not fire when recent episode count is below threshold', () => {
    const out = detectAbsenceLong({
      householdId: HOUSEHOLD,
      people: [person()],
      episodes: [ep('e-1', '2026-02-01T00:00:00Z')],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('does not fire when person was seen within the fresh window', () => {
    const recent = new Date(
      now.getTime() - (ABSENCE_THRESHOLD_DAYS - 5) * 86_400_000,
    ).toISOString();
    const out = detectAbsenceLong({
      householdId: HOUSEHOLD,
      people: [person()],
      episodes: [
        ep('e-1', '2026-02-01T00:00:00Z'),
        ep('e-2', '2026-02-15T00:00:00Z'),
        ep('e-3', recent),
      ],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('ignores soft-deleted person nodes', () => {
    const out = detectAbsenceLong({
      householdId: HOUSEHOLD,
      people: [person({ metadata: { deleted_at: now.toISOString() } })],
      episodes: [
        ep('e-1', '2026-01-05T00:00:00Z'),
        ep('e-2', '2026-01-20T00:00:00Z'),
        ep('e-3', '2026-02-01T00:00:00Z'),
      ],
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('ignores other households', () => {
    const out = detectAbsenceLong({
      householdId: HOUSEHOLD,
      people: [person({ household_id: 'other' })],
      episodes: [
        ep('e-1', '2026-01-05T00:00:00Z'),
        ep('e-2', '2026-01-20T00:00:00Z'),
        ep('e-3', '2026-02-01T00:00:00Z'),
      ],
      now,
    });
    expect(out).toHaveLength(0);
  });
});
