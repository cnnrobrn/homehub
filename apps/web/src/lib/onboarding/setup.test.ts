import { describe, expect, it } from 'vitest';

import {
  buildAlfredSetupPrompt,
  buildHermesOnboardingStartPrompt,
  getConfiguredSetupSegments,
  getVisibleSetupHrefs,
} from './setup';

describe('onboarding setup helpers', () => {
  it('keeps legacy households fully visible when no setup settings exist', () => {
    expect(getConfiguredSetupSegments({})).toEqual(['financial', 'food', 'fun', 'social']);
    expect(getVisibleSetupHrefs({}, 'food')).toBeNull();
  });

  it('supports chat-driven households that start with no visible setup sections', () => {
    const settings = {
      onboarding: {
        setup_segments: [],
        setup_prompt_ids: [],
      },
    };
    expect(getConfiguredSetupSegments(settings)).toEqual([]);
    expect(getVisibleSetupHrefs(settings, 'food')).toEqual([]);
  });

  it('returns only the tabs revealed by the onboarding skill', () => {
    const settings = {
      onboarding: {
        setup_segments: ['food'],
        setup_prompt_ids: ['food.pantry', 'food.groceries'],
      },
    };
    expect(getConfiguredSetupSegments(settings)).toEqual(['food']);
    expect(getVisibleSetupHrefs(settings, 'food')).toEqual(['/food/pantry', '/food/groceries']);
  });

  it('seeds Hermes onboarding prompts with the skill contract', () => {
    expect(buildHermesOnboardingStartPrompt({ householdName: 'Casa' })).toContain(
      'HomeHub onboarding skill',
    );
    expect(
      buildAlfredSetupPrompt({
        householdName: 'Casa',
        selectedSegmentIds: ['food'],
        selectedPromptIds: ['food.pantry'],
      }),
    ).toContain('HomeHub onboarding skill');
  });
});
