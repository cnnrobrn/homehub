import { describe, expect, it } from 'vitest';

import { detectReciprocityImbalance } from './reciprocity-imbalance.js';
import { type SocialEpisode, type SocialPersonNode } from './types.js';

const HOUSEHOLD = 'h-1';
const PERSON = 'p-1';
const HOME = 'place-home';
const THEIRS = 'place-theirs';

function person(): SocialPersonNode {
  return {
    id: PERSON,
    household_id: HOUSEHOLD,
    canonical_name: 'Garcia family',
    metadata: {},
    needs_review: false,
    created_at: '2025-01-01T00:00:00Z',
  };
}

function host(place: string, occurredAt: string): SocialEpisode {
  return {
    id: `e-${place}-${occurredAt}`,
    household_id: HOUSEHOLD,
    occurred_at: occurredAt,
    participants: [PERSON],
    place_node_id: place,
    source_type: 'event',
    metadata: {},
  };
}

describe('detectReciprocityImbalance', () => {
  const now = new Date('2026-04-20T00:00:00Z');
  const homePlaces = new Set([HOME]);

  it('emits info when we host more than 2× what they host us', () => {
    const out = detectReciprocityImbalance({
      householdId: HOUSEHOLD,
      people: [person()],
      episodes: [
        host(HOME, '2026-01-10T00:00:00Z'),
        host(HOME, '2026-02-10T00:00:00Z'),
        host(HOME, '2026-03-10T00:00:00Z'),
        host(THEIRS, '2026-01-20T00:00:00Z'),
      ],
      homePlaces,
      now,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe('info');
    expect(out[0]!.kind).toBe('reciprocity_imbalance');
    expect(out[0]!.context.we_hosted).toBe(3);
    expect(out[0]!.context.hosted_us).toBe(1);
  });

  it('does not fire when roughly reciprocal', () => {
    const out = detectReciprocityImbalance({
      householdId: HOUSEHOLD,
      people: [person()],
      episodes: [
        host(HOME, '2026-01-10T00:00:00Z'),
        host(HOME, '2026-02-10T00:00:00Z'),
        host(THEIRS, '2026-01-20T00:00:00Z'),
        host(THEIRS, '2026-02-20T00:00:00Z'),
      ],
      homePlaces,
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('does not fire when weHosted is below the minimum (2)', () => {
    const out = detectReciprocityImbalance({
      householdId: HOUSEHOLD,
      people: [person()],
      episodes: [host(HOME, '2026-03-10T00:00:00Z')],
      homePlaces,
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('fires when they have never hosted us but we hosted >=2 times', () => {
    const out = detectReciprocityImbalance({
      householdId: HOUSEHOLD,
      people: [person()],
      episodes: [host(HOME, '2026-02-01T00:00:00Z'), host(HOME, '2026-03-01T00:00:00Z')],
      homePlaces,
      now,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.context.hosted_us).toBe(0);
  });

  it('ignores episodes without place_node_id', () => {
    const out = detectReciprocityImbalance({
      householdId: HOUSEHOLD,
      people: [person()],
      episodes: [
        { ...host(HOME, '2026-03-10T00:00:00Z'), place_node_id: null },
        host(HOME, '2026-03-15T00:00:00Z'),
      ],
      homePlaces,
      now,
    });
    expect(out).toHaveLength(0);
  });
});
