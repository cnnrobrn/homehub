import { describe, expect, it } from 'vitest';

import { DEFAULTS, resolveDefaults } from './defaults.js';

describe('resolveDefaults', () => {
  it('returns the exact match when present', () => {
    const params = resolveDefaults('enrichment.event');
    expect(params.model).toBe('moonshotai/kimi-k2');
    expect(params.temperature).toBe(0.2);
    expect(params.topP).toBe(0.9);
    expect(params.maxOutputTokens).toBe(2000);
    expect(params.jsonMode).toBe(true);
  });

  it('falls back from a specific task to its parent prefix', () => {
    // `enrichment.somethingNew` has no dedicated entry; should inherit
    // from `enrichment`.
    const params = resolveDefaults('enrichment.somethingNew');
    expect(params).toEqual(DEFAULTS.enrichment);
  });

  it('falls back to background when no prefix matches', () => {
    const params = resolveDefaults('totally.unknown.task');
    expect(params).toEqual(DEFAULTS.background);
  });

  it('summarization defaults match the spec', () => {
    const p = resolveDefaults('summarization');
    expect(p.temperature).toBe(0.5);
    expect(p.maxOutputTokens).toBe(1500);
    expect(p.jsonMode).toBe(false);
  });

  it('suggestion defaults match the spec', () => {
    const p = resolveDefaults('suggestion');
    expect(p.temperature).toBe(0.4);
    expect(p.maxOutputTokens).toBe(1000);
    expect(p.jsonMode).toBe(true);
  });

  it('foreground uses a stronger model', () => {
    const p = resolveDefaults('foreground');
    expect(p.model).not.toBe('moonshotai/kimi-k2');
    expect(p.maxOutputTokens).toBe(4000);
  });
});
