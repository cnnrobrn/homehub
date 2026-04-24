import { describe, expect, it } from 'vitest';

import {
  ONBOARDING_START_PROMPTS,
  buildAlfredSetupPrompt,
  buildHermesOnboardingStartPrompt,
  getConfiguredSetupSegments,
  getConfiguredSetupSurfaces,
  getVisibleSetupHrefs,
} from './setup';

describe('onboarding setup helpers', () => {
  it('keeps legacy households fully visible when no setup settings exist', () => {
    expect(getConfiguredSetupSegments({})).toEqual(['financial', 'food', 'fun', 'social']);
    expect(getConfiguredSetupSurfaces({})).toEqual(['calendar', 'decisions']);
    expect(getVisibleSetupHrefs({}, 'food')).toBeNull();
  });

  it('supports chat-driven households that start with no visible setup sections', () => {
    const settings = {
      onboarding: {
        setup_segments: [],
        setup_prompt_ids: [],
        setup_surface_ids: [],
      },
    };
    expect(getConfiguredSetupSegments(settings)).toEqual([]);
    expect(getConfiguredSetupSurfaces(settings)).toEqual([]);
    expect(getVisibleSetupHrefs(settings, 'food')).toEqual([]);
  });

  it('returns only the tabs revealed by the onboarding skill', () => {
    const settings = {
      onboarding: {
        setup_segments: ['food'],
        setup_prompt_ids: ['food.pantry', 'food.groceries'],
        setup_surface_ids: ['decisions'],
      },
    };
    expect(getConfiguredSetupSegments(settings)).toEqual(['food']);
    expect(getConfiguredSetupSurfaces(settings)).toEqual(['decisions']);
    expect(getVisibleSetupHrefs(settings, 'food')).toEqual(['/food/pantry', '/food/groceries']);
  });

  it('infers the global calendar surface from revealed calendar tabs', () => {
    const settings = {
      onboarding: {
        setup_segments: ['social'],
        setup_prompt_ids: ['social.calendar'],
        setup_surface_ids: [],
      },
    };
    expect(getConfiguredSetupSurfaces(settings)).toEqual(['calendar']);
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

  it('offers several onboarding starter prompts', () => {
    expect(ONBOARDING_START_PROMPTS.length).toBeGreaterThanOrEqual(4);
    expect(buildHermesOnboardingStartPrompt({ householdName: 'Casa', promptId: 'week' })).toContain(
      'this week',
    );
  });
});
