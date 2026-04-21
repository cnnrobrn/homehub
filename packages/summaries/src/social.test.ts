import { type HouseholdId } from '@homehub/shared';
import { describe, expect, it } from 'vitest';

import { computeSocialMetrics, renderSocialSummary } from './social.js';
import {
  type SocialEpisodeRow,
  type SocialEventRow,
  type SocialPersonRow,
  type SocialSummaryInput,
} from './types.js';

const HOUSEHOLD = '00000000-0000-4000-8000-000000000001' as HouseholdId;
const PRIYA = 'p-1';
const MOM = 'p-2';

function ep(id: string, occurredAt: string, participants: string[]): SocialEpisodeRow {
  return {
    id,
    household_id: HOUSEHOLD,
    occurred_at: occurredAt,
    participants,
    place_node_id: null,
    source_type: 'event',
    metadata: {},
  };
}

function person(id: string, name: string, createdAt: string): SocialPersonRow {
  return {
    id,
    household_id: HOUSEHOLD,
    canonical_name: name,
    created_at: createdAt,
    metadata: {},
  };
}

function upcoming(id: string, title: string, startsAt: string): SocialEventRow {
  return {
    id,
    household_id: HOUSEHOLD,
    kind: 'birthday',
    title,
    starts_at: startsAt,
    metadata: {},
  };
}

describe('computeSocialMetrics', () => {
  const input: SocialSummaryInput = {
    householdId: HOUSEHOLD,
    period: 'weekly',
    coveredStart: '2026-04-06T00:00:00Z',
    coveredEnd: '2026-04-13T00:00:00Z',
    episodes: [
      ep('e-1', '2026-04-07T18:00:00Z', [PRIYA, MOM]),
      ep('e-2', '2026-04-08T19:00:00Z', [PRIYA]),
      ep('e-3', '2026-04-11T20:00:00Z', [MOM]),
    ],
    people: [
      person(PRIYA, 'Priya', '2026-04-10T00:00:00Z'),
      person(MOM, 'Mom', '2025-01-01T00:00:00Z'),
    ],
    upcomingEvents: [upcoming('ev-1', "Priya's birthday", '2026-04-25T00:00:00Z')],
    absentPersons: [
      {
        id: 'p-3',
        household_id: HOUSEHOLD,
        canonical_name: 'Uncle Ed',
        lastSeenAt: '2026-01-15T00:00:00Z',
      },
    ],
    personNames: new Map([
      [PRIYA, 'Priya'],
      [MOM, 'Mom'],
    ]),
  };

  it('counts unique people, ranks top people, and flags new persons', () => {
    const m = computeSocialMetrics(input);
    expect(m.uniquePeopleCount).toBe(2);
    expect(m.topPeople[0]).toEqual({
      personNodeId: PRIYA,
      canonicalName: 'Priya',
      episodeCount: 2,
    });
    expect(m.topPeople[1]).toEqual({ personNodeId: MOM, canonicalName: 'Mom', episodeCount: 2 });
    expect(m.newPeople).toEqual([{ personNodeId: PRIYA, canonicalName: 'Priya' }]);
    expect(m.upcomingEvents).toHaveLength(1);
    expect(m.absentPersons).toHaveLength(1);
  });

  it('renders markdown with expected sections', () => {
    const out = renderSocialSummary(input);
    expect(out.bodyMd).toContain('Weekly social brief');
    expect(out.bodyMd).toContain('**People you saw:** 2');
    expect(out.bodyMd).toContain('Priya');
    expect(out.bodyMd).toContain('Uncle Ed');
    expect(out.bodyMd).toContain('Coming up');
  });

  it('produces a no-activity body when nothing in period', () => {
    const out = renderSocialSummary({
      ...input,
      episodes: [],
      upcomingEvents: [],
      absentPersons: [],
      people: [],
    });
    expect(out.bodyMd).toContain('No social activity');
  });
});
