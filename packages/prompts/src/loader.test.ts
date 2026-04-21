/**
 * Unit tests for the markdown prompt loader + renderer.
 *
 * Coverage:
 *   - `loadPrompt('event')` returns populated sections (system, user
 *     template, schema name, version, examples).
 *   - `loadPrompt('event-classifier')` returns a separate prompt.
 *   - `loadPrompt('node-doc')` resolves from the `node-doc` subfolder.
 *   - `renderPrompt` substitutes `{{key}}` placeholders and throws
 *     `PromptRenderError` when a required slot is missing.
 *   - `loadPrompt` throws `PromptLoadError` on unknown names and on
 *     names that violate the allowed-character pattern.
 *   - Schemas reject invalid shapes and accept valid ones.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  PromptLoadError,
  PromptRenderError,
  _clearPromptCache,
  eventClassifierSchema,
  eventExtractionSchema,
  loadPrompt,
  nodeDocSchema,
  renderPrompt,
} from './index.js';

beforeEach(() => {
  _clearPromptCache();
});

describe('loadPrompt', () => {
  it('parses event.md into the conventional sections', () => {
    const prompt = loadPrompt('event');
    expect(prompt.name).toBe('event');
    expect(prompt.version).toBe('2026-04-20-kimi-k2-v1');
    expect(prompt.schemaName).toBe('eventExtractionSchema');
    expect(prompt.systemPrompt).toMatch(/HomeHub enrichment model/);
    expect(prompt.systemPrompt).toContain('{{household_context}}');
    expect(prompt.userPromptTemplate).toContain('{{title}}');
    expect(prompt.userPromptTemplate).toContain('{{attendees}}');
    expect(prompt.examples.length).toBeGreaterThan(0);
  });

  it('parses event-classifier.md separately', () => {
    const prompt = loadPrompt('event-classifier');
    expect(prompt.version).toBe('2026-04-20-kimi-k2-v1');
    expect(prompt.schemaName).toBe('eventClassifierSchema');
    expect(prompt.systemPrompt).toMatch(/HomeHub event classifier/);
    expect(prompt.userPromptTemplate).toContain('{{title}}');
  });

  it('finds node-doc.md in the node-doc subfolder', () => {
    const prompt = loadPrompt('node-doc');
    expect(prompt.schemaName).toBe('nodeDocSchema');
    expect(prompt.userPromptTemplate).toContain('{{node_type}}');
  });

  it('rejects unknown prompt names', () => {
    expect(() => loadPrompt('definitely-not-a-prompt')).toThrow(PromptLoadError);
  });

  it('rejects invalid prompt-name characters', () => {
    expect(() => loadPrompt('../etc/passwd')).toThrow(PromptLoadError);
    expect(() => loadPrompt('Event')).toThrow(PromptLoadError); // uppercase not allowed
  });

  it('caches loaded prompts in-process', () => {
    const a = loadPrompt('event');
    const b = loadPrompt('event');
    expect(a).toBe(b);
  });
});

describe('renderPrompt', () => {
  it('substitutes {{slot}} placeholders', () => {
    const prompt = loadPrompt('event-classifier');
    const rendered = renderPrompt(prompt, {
      household_context: 'Acme Household.',
      title: 'Focus time',
      description: 'Deep work.',
      location: '',
      starts_at: '2026-05-02T15:00:00Z',
      ends_at: '',
      all_day: 'false',
      provider: 'gcal',
      owner_email: 'owner@example.com',
      attendees: '(none)',
    });
    expect(rendered.systemPrompt).toContain('Acme Household.');
    expect(rendered.systemPrompt).not.toContain('{{household_context}}');
    expect(rendered.userPrompt).toContain('Focus time');
    expect(rendered.userPrompt).toContain('owner@example.com');
    expect(rendered.userPrompt).not.toMatch(/\{\{.*\}\}/);
  });

  it('throws PromptRenderError listing every unfilled slot', () => {
    const prompt = loadPrompt('event-classifier');
    expect(() =>
      renderPrompt(prompt, {
        household_context: 'Acme.',
        title: 'x',
        // Intentionally drop several required slots.
      }),
    ).toThrow(PromptRenderError);
    try {
      renderPrompt(prompt, { household_context: 'Acme.', title: 'x' });
    } catch (err) {
      expect(err).toBeInstanceOf(PromptRenderError);
      const pre = err as PromptRenderError;
      expect(pre.missing).toContain('description');
      expect(pre.missing).toContain('location');
    }
  });
});

describe('schemas', () => {
  it('eventExtractionSchema accepts a valid response', () => {
    const sample = {
      episodes: [
        {
          occurred_at: '2026-04-25T23:00:00Z',
          title: 'Dinner',
          summary: 'Dinner at Giulia.',
          participants: ['person:Sarah'],
          mentions_facts: ['f_001'],
        },
      ],
      facts: [
        {
          id: 'f_001',
          subject: 'person:Sarah',
          predicate: 'is',
          object_value: 'vegetarian',
          confidence: 0.8,
          evidence: 'chose vegetarian option',
          valid_from: 'inferred',
        },
      ],
    };
    const parsed = eventExtractionSchema.parse(sample);
    expect(parsed.facts[0]?.predicate).toBe('is');
    expect(parsed.episodes[0]?.mentions_facts).toEqual(['f_001']);
  });

  it('eventExtractionSchema rejects facts with out-of-range confidence', () => {
    const bad = {
      episodes: [],
      facts: [
        {
          id: 'f_001',
          subject: 'x',
          predicate: 'y',
          confidence: 1.2,
          evidence: 'e',
          valid_from: 'inferred',
        },
      ],
    };
    const result = eventExtractionSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('eventClassifierSchema accepts the classifier shape', () => {
    const parsed = eventClassifierSchema.parse({
      segment: 'food',
      kind: 'reservation',
      confidence: 0.9,
      rationale: 'named restaurant',
      signals: ['title.keyword:reservation'],
    });
    expect(parsed.segment).toBe('food');
  });

  it('eventClassifierSchema rejects an unknown segment', () => {
    const result = eventClassifierSchema.safeParse({
      segment: 'housework',
      kind: 'meeting',
      confidence: 0.9,
      rationale: 'x',
      signals: ['y'],
    });
    expect(result.success).toBe(false);
  });

  it('nodeDocSchema requires a non-empty document_md', () => {
    expect(nodeDocSchema.safeParse({ document_md: 'ok' }).success).toBe(true);
    expect(nodeDocSchema.safeParse({ document_md: '' }).success).toBe(false);
  });
});
