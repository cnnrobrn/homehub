/**
 * Unit tests for `stripCitationFootnote`.
 *
 * Covers:
 *   - body with no footnote → passthrough.
 *   - body with a well-formed footnote → split.
 *   - body with a malformed JSON footnote → graceful fallback.
 *   - trailing whitespace handling.
 */

import { describe, expect, it } from 'vitest';

import { stripCitationFootnote } from './insights';

describe('stripCitationFootnote', () => {
  it('returns the body unchanged when no footnote is present', () => {
    const body = '## Week of April 14\n\nYou shopped twice and cooked four times.';
    const result = stripCitationFootnote(body);
    expect(result.cleanBody).toBe(body);
    expect(result.citations).toBeUndefined();
    expect(result.rawFootnote).toBeUndefined();
  });

  it('splits a well-formed footnote into citations', () => {
    const body =
      '## Week of April 14\n\nYou cooked four times.\n\n' +
      '<!-- homehub:reflection {"citations":[{"fact_id":"f1"},{"episode_id":"e1"}]} -->';
    const result = stripCitationFootnote(body);
    expect(result.cleanBody).toBe('## Week of April 14\n\nYou cooked four times.');
    expect(result.citations).toEqual([{ fact_id: 'f1' }, { episode_id: 'e1' }]);
    expect(result.rawFootnote).toContain('homehub:reflection');
  });

  it('tolerates trailing whitespace after the footnote', () => {
    const body =
      'Body.\n\n' + '<!-- homehub:reflection {"citations":[{"node_id":"n1"}]} -->\n\n   ';
    const result = stripCitationFootnote(body);
    expect(result.cleanBody).toBe('Body.');
    expect(result.citations).toEqual([{ node_id: 'n1' }]);
  });

  it('ignores malformed JSON but still strips the footnote', () => {
    const body = 'Body.\n\n<!-- homehub:reflection {not valid json} -->';
    const result = stripCitationFootnote(body);
    expect(result.cleanBody).toBe('Body.');
    expect(result.citations).toBeUndefined();
    expect(result.rawFootnote).toContain('homehub:reflection');
  });

  it('ignores an empty JSON payload', () => {
    const body = 'Body.\n\n<!-- homehub:reflection  -->';
    const result = stripCitationFootnote(body);
    expect(result.cleanBody).toBe('Body.');
    expect(result.citations).toBeUndefined();
  });

  it('does not strip when the sentinel appears mid-document', () => {
    const body =
      'Body before.\n\n' +
      '<!-- homehub:reflection {"citations":[{"fact_id":"f1"}]} -->\n\n' +
      'Trailing text.';
    const result = stripCitationFootnote(body);
    // Sentinel is not at the tail, so we leave the body alone.
    expect(result.cleanBody).toBe(body);
    expect(result.citations).toBeUndefined();
  });
});
