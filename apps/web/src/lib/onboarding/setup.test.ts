import { describe, expect, it } from 'vitest';

import {
  ONBOARDING_START_PROMPTS,
  buildAlfredSetupPrompt,
  buildHermesOnboardingStartPrompt,
  getConfiguredSetupSegments,
  getConfiguredSetupSurfaces,
} from './setup';

describe('onboarding setup helpers', () => {
  it('keeps legacy households fully visible when no setup settings exist', () => {
    expect(getConfiguredSetupSegments({})).toEqual(['financial', 'food', 'fun', 'social']);
    expect(getConfiguredSetupSurfaces({})).toEqual(['calendar', 'decisions']);
  });

  it('keeps chat-driven households fully visible even with empty setup settings', () => {
    const settings = {
      onboarding: {
        setup_segments: [],
        setup_prompt_ids: [],
        setup_surface_ids: [],
      },
    };
    expect(getConfiguredSetupSegments(settings)).toEqual(['financial', 'food', 'fun', 'social']);
    expect(getConfiguredSetupSurfaces(settings)).toEqual(['calendar', 'decisions']);
  });

  it('does not hide navigation for partially configured onboarding settings', () => {
    const settings = {
      onboarding: {
        setup_segments: ['food'],
        setup_prompt_ids: ['food.pantry', 'food.groceries'],
        setup_surface_ids: ['decisions'],
      },
    };
    expect(getConfiguredSetupSegments(settings)).toEqual(['financial', 'food', 'fun', 'social']);
    expect(getConfiguredSetupSurfaces(settings)).toEqual(['calendar', 'decisions']);
  });

  it('shows top-level surfaces even when onboarding did not select them', () => {
    const settings = {
      onboarding: {
        setup_segments: ['social'],
        setup_prompt_ids: ['social.calendar'],
        setup_surface_ids: [],
      },
    };
    expect(getConfiguredSetupSurfaces(settings)).toEqual(['calendar', 'decisions']);
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
    expect(buildHermesOnboardingStartPrompt({ householdName: 'Casa' })).not.toContain(
      'Only reveal',
    );
  });

  it('offers several onboarding starter prompts', () => {
    expect(ONBOARDING_START_PROMPTS.length).toBeGreaterThanOrEqual(4);
    expect(buildHermesOnboardingStartPrompt({ householdName: 'Casa', promptId: 'week' })).toContain(
      'this week',
    );
  });
});
