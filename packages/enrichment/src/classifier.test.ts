/**
 * Snapshot-style unit tests for the deterministic classifier.
 *
 * Loads every JSON fixture under `fixtures/events/*.json` and asserts
 * that the classifier returns a classification matching the file's
 * `expected` block. Every fixture is a single `{ input, expected }`
 * pair; see `fixtures/events/README.md`.
 *
 * The assertion is intentionally stricter than just segment+kind so
 * regressions in the signal set or confidence tier get caught — but
 * `rationale` is not compared textually. It's validated via the
 * `EventClassification` Zod schema (non-empty string).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  createDeterministicEventClassifier,
  eventClassificationSchema,
  eventInputSchema,
  type EventClassification,
  type EventInput,
} from './index.js';

interface Fixture {
  name: string;
  description?: string;
  input: EventInput;
  expected: Pick<EventClassification, 'segment' | 'kind' | 'confidence' | 'signals'>;
}

const fixturesDir = fileURLToPath(new URL('../fixtures/events/', import.meta.url));

function loadFixtures(): Fixture[] {
  const files = readdirSync(fixturesDir)
    .filter((name) => name.endsWith('.json'))
    .sort();
  return files.map((file) => {
    const raw = JSON.parse(readFileSync(`${fixturesDir}${file}`, 'utf8')) as Fixture;
    // Parse the input through the zod schema so any drift in the
    // fixture shape is caught at load time, not in the middle of the
    // classifier.
    const input = eventInputSchema.parse(raw.input);
    return { ...raw, input };
  });
}

const classifier = createDeterministicEventClassifier();

describe('createDeterministicEventClassifier — fixtures', () => {
  const fixtures = loadFixtures();

  // Sanity: every segment has at least one fixture. Keeps coverage
  // honest as we add rules.
  it('covers every segment', () => {
    const segments = new Set(fixtures.map((f) => f.expected.segment));
    expect(segments).toEqual(new Set(['financial', 'food', 'fun', 'social', 'system']));
  });

  it('has at least 20 fixtures', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
  });

  for (const fixture of fixtures) {
    it(`classifies: ${fixture.name}`, () => {
      const result = classifier.classify(fixture.input);

      // Full classification validates against the exported Zod schema.
      expect(() => eventClassificationSchema.parse(result)).not.toThrow();

      expect(result.segment).toBe(fixture.expected.segment);
      expect(result.kind).toBe(fixture.expected.kind);
      expect(result.confidence).toBe(fixture.expected.confidence);
      expect(result.signals).toEqual(fixture.expected.signals);
      // Rationale is a human-readable string; assert shape, not content.
      expect(typeof result.rationale).toBe('string');
      expect(result.rationale.length).toBeGreaterThan(0);
    });
  }
});

describe('createDeterministicEventClassifier — idempotency', () => {
  const fixtures = loadFixtures();

  it('produces the same classification on a repeat call', () => {
    for (const fixture of fixtures) {
      const a = classifier.classify(fixture.input);
      const b = classifier.classify(fixture.input);
      expect(a).toEqual(b);
    }
  });
});

describe('createDeterministicEventClassifier — ordering invariants', () => {
  it('puts "birthday party" in social, not fun', () => {
    const result = classifier.classify({
      title: 'Lila birthday party',
      startsAt: '2026-05-16T20:00:00.000Z',
      allDay: false,
      attendees: [],
      ownerEmail: 'owner@example.com',
    });
    expect(result.segment).toBe('social');
    expect(result.kind).toBe('birthday');
  });

  it('puts "OpenTable reservation" in food with kind reservation', () => {
    const result = classifier.classify({
      title: 'OpenTable reservation',
      startsAt: '2026-05-01T23:00:00.000Z',
      allDay: false,
      attendees: [],
      ownerEmail: 'owner@example.com',
    });
    expect(result.segment).toBe('food');
    expect(result.kind).toBe('reservation');
  });

  it('bank-branch location with no keywords classifies as financial', () => {
    const result = classifier.classify({
      title: 'Appointment',
      location: 'Chase — Downtown Crossing',
      startsAt: '2026-05-01T18:00:00.000Z',
      allDay: false,
      attendees: [],
      ownerEmail: 'owner@example.com',
    });
    expect(result.segment).toBe('financial');
  });
});
