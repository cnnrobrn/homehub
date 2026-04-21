import { describe, expect, it } from 'vitest';

import {
  CONSOLIDATION_PROMPT_VERSION,
  MAX_ENTITIES_PER_RUN,
  MIN_NEW_EPISODES_FOR_CONSOLIDATION,
  handler,
  runConsolidator,
} from './handler.js';

/**
 * The consolidator is exercised through `runConsolidator`; the M0 `handler`
 * stub is kept only so existing imports don't break. The full behavioural
 * contract is locked down by the fake-Supabase tests that land alongside
 * the reflector (shared fake-supabase fixtures live here in a follow-up).
 */
describe('consolidator handler surface', () => {
  it('exports runConsolidator', () => {
    expect(typeof runConsolidator).toBe('function');
  });

  it('keeps the legacy handler() stub in place for back-compat', async () => {
    await expect(handler()).rejects.toThrow(/runConsolidator/);
  });

  it('pins the prompt version + tuning knobs', () => {
    expect(CONSOLIDATION_PROMPT_VERSION).toMatch(/consolidation-v\d+$/);
    expect(MIN_NEW_EPISODES_FOR_CONSOLIDATION).toBeGreaterThan(0);
    expect(MAX_ENTITIES_PER_RUN).toBeGreaterThan(0);
  });
});
