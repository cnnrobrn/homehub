/**
 * Unit tests for the ranking helpers.
 */

import { describe, expect, it } from 'vitest';

import {
  cosineSimilarity,
  normalizedSimilarity,
  recencyWeight,
  connectivityWeight,
  typePriorWeight,
  conflictPenalty,
  scoreNode,
  scoreFact,
} from './ranking.js';
import { DEFAULT_RANKING_WEIGHTS, type FactRow, type NodeRow } from './types.js';

function fakeNode(patch: Partial<NodeRow> = {}): NodeRow {
  return {
    id: 'n1',
    household_id: 'h1',
    type: 'person',
    canonical_name: 'Sarah',
    document_md: null,
    manual_notes_md: null,
    metadata: {},
    embedding: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    needs_review: false,
    ...patch,
  };
}

function fakeFact(patch: Partial<FactRow> = {}): FactRow {
  return {
    id: 'f1',
    household_id: 'h1',
    subject_node_id: 'n1',
    predicate: 'is',
    object_value: 'vegetarian',
    object_node_id: null,
    confidence: 0.8,
    evidence: [],
    valid_from: '2026-01-01T00:00:00Z',
    valid_to: null,
    recorded_at: '2026-01-01T00:00:00Z',
    superseded_at: null,
    superseded_by: null,
    source: 'extraction',
    reinforcement_count: 1,
    last_reinforced_at: '2026-01-01T00:00:00Z',
    conflict_status: 'none',
    ...patch,
  };
}

describe('cosineSimilarity', () => {
  it('returns 1 for identical unit vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
  });
  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });
  it('returns -1 for antiparallel vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
  });
  it('returns 0 on mismatched dimensions', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0])).toBe(0);
  });
});

describe('recencyWeight', () => {
  it('returns ~1 for very-recent reinforcements', () => {
    const now = new Date('2026-04-20T00:00:00Z');
    expect(recencyWeight('2026-04-19T23:00:00Z', now)).toBeGreaterThan(0.99);
  });
  it('returns 0.5 for reinforcements 30 days old at the default half-life', () => {
    const now = new Date('2026-04-20T00:00:00Z');
    const val = recencyWeight('2026-03-21T00:00:00Z', now);
    expect(val).toBeCloseTo(0.5, 1);
  });
  it('returns 0 for null input', () => {
    expect(recencyWeight(null, new Date())).toBe(0);
  });
});

describe('connectivityWeight', () => {
  it('increases with edge count', () => {
    expect(connectivityWeight(0)).toBe(0);
    expect(connectivityWeight(5)).toBeGreaterThan(connectivityWeight(1));
    expect(connectivityWeight(100)).toBeLessThanOrEqual(1);
  });
});

describe('typePriorWeight', () => {
  it('returns 1 when filter is empty', () => {
    expect(typePriorWeight('person', [])).toBe(1);
    expect(typePriorWeight('person', undefined)).toBe(1);
  });
  it('returns 1 when the type is in the filter', () => {
    expect(typePriorWeight('person', ['person', 'place'])).toBe(1);
  });
  it('returns 0 when the type is excluded', () => {
    expect(typePriorWeight('person', ['place'])).toBe(0);
  });
});

describe('conflictPenalty', () => {
  it('returns 1 for parked_conflict facts', () => {
    expect(conflictPenalty(fakeFact({ conflict_status: 'parked_conflict' }), new Date())).toBe(1);
  });
  it('returns 0 for normal facts', () => {
    expect(conflictPenalty(fakeFact(), new Date())).toBe(0);
  });
  it('returns 0.5 for facts superseded within 30 days', () => {
    const now = new Date('2026-04-20T00:00:00Z');
    const penalty = conflictPenalty(fakeFact({ superseded_at: '2026-04-01T00:00:00Z' }), now);
    expect(penalty).toBe(0.5);
  });
});

describe('scoreNode', () => {
  it('weights semantic similarity most heavily by default', () => {
    const now = new Date('2026-04-20T00:00:00Z');
    const strong = scoreNode({
      node: fakeNode(),
      similarity: 1,
      edgeCount: 0,
      weights: DEFAULT_RANKING_WEIGHTS,
      now,
    });
    const weak = scoreNode({
      node: fakeNode(),
      similarity: -1,
      edgeCount: 0,
      weights: DEFAULT_RANKING_WEIGHTS,
      now,
    });
    expect(strong).toBeGreaterThan(weak);
  });
});

describe('scoreFact', () => {
  it('conflict penalty lowers the score', () => {
    const now = new Date('2026-04-20T00:00:00Z');
    const clean = scoreFact({
      fact: fakeFact(),
      subjectSimilarity: 0.5,
      weights: DEFAULT_RANKING_WEIGHTS,
      now,
    });
    const conflicting = scoreFact({
      fact: fakeFact({ conflict_status: 'parked_conflict' }),
      subjectSimilarity: 0.5,
      weights: DEFAULT_RANKING_WEIGHTS,
      now,
    });
    expect(clean).toBeGreaterThan(conflicting);
  });
});

describe('normalizedSimilarity', () => {
  it('maps [-1,1] cosine to [0,1]', () => {
    expect(normalizedSimilarity(-1)).toBe(0);
    expect(normalizedSimilarity(0)).toBe(0.5);
    expect(normalizedSimilarity(1)).toBe(1);
  });
});
