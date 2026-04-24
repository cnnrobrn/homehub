import { SEGMENT_ORDER, SEGMENTS, type SegmentId } from '@/components/design-system/segment';

const SETUP_SURFACE_ORDER = ['calendar', 'decisions'] as const;
export type SetupSurfaceId = (typeof SETUP_SURFACE_ORDER)[number];

export interface SetupPrompt {
  id: string;
  label: string;
  detail: string;
  href: string;
  prompt: string;
}

export interface SetupSection {
  id: SegmentId;
  title: string;
  description: string;
  prompts: readonly SetupPrompt[];
}

export interface OnboardingStartPrompt {
  id: string;
  label: string;
  detail: string;
  prompt: string;
}

export const SETUP_SECTIONS: readonly SetupSection[] = [
  {
    id: 'financial',
    title: 'Money',
    description: 'Accounts, bills, subscriptions, and budgets.',
    prompts: [
      {
        id: 'financial.accounts',
        label: 'Accounts',
        detail: 'What accounts and balances should Alfred track?',
        href: '/financial/accounts',
        prompt: 'Help me set up the accounts and balances Alfred should track.',
      },
      {
        id: 'financial.budgets',
        label: 'Budgets',
        detail: 'Monthly targets, shared spending, and categories.',
        href: '/financial/budgets',
        prompt: 'Help me set up household budgets and spending categories.',
      },
      {
        id: 'financial.subscriptions',
        label: 'Subscriptions',
        detail: 'Recurring charges and renewal decisions.',
        href: '/financial/subscriptions',
        prompt: 'Help me identify recurring subscriptions and what needs review.',
      },
      {
        id: 'financial.calendar',
        label: 'Bill calendar',
        detail: 'Due dates and upcoming autopays.',
        href: '/financial/calendar',
        prompt: 'Help me build a calendar of bills, autopays, and money deadlines.',
      },
    ],
  },
  {
    id: 'food',
    title: 'Food',
    description: 'Meals, pantry, groceries, and household preferences.',
    prompts: [
      {
        id: 'food.meal-planner',
        label: 'Meal planner',
        detail: 'Dinner rhythm and meals already planned.',
        href: '/food/meal-planner',
        prompt: 'Help me set up a simple household meal plan.',
      },
      {
        id: 'food.pantry',
        label: 'Pantry',
        detail: 'Staples, expiring items, and what is on hand.',
        href: '/food/pantry',
        prompt: 'Help me capture what is in the pantry and what expires soon.',
      },
      {
        id: 'food.groceries',
        label: 'Groceries',
        detail: 'Shopping lists and recurring household items.',
        href: '/food/groceries',
        prompt: 'Help me create the household grocery setup and recurring staples.',
      },
      {
        id: 'food.dishes',
        label: 'Dishes',
        detail: 'Favorites, dislikes, and rotation ideas.',
        href: '/food/dishes',
        prompt: 'Help me capture favorite dishes, dislikes, and meal rotation ideas.',
      },
    ],
  },
  {
    id: 'fun',
    title: 'Fun',
    description: 'Trips, outings, hobbies, reservations, and ideas.',
    prompts: [
      {
        id: 'fun.trips',
        label: 'Trips',
        detail: 'Travel dates, lodging, flights, and prep.',
        href: '/fun/trips',
        prompt: 'Help me set up upcoming trips, reservations, and prep tasks.',
      },
      {
        id: 'fun.queue',
        label: 'Queue',
        detail: 'Movies, restaurants, shows, and household ideas.',
        href: '/fun/queue',
        prompt: 'Help me start a queue of places, shows, and fun ideas.',
      },
      {
        id: 'fun.calendar',
        label: 'Fun calendar',
        detail: 'Events, outings, and ticketed plans.',
        href: '/fun/calendar',
        prompt: 'Help me organize upcoming outings and ticketed events.',
      },
      {
        id: 'fun.alerts',
        label: 'Reminders',
        detail: 'Packing, bookings, and decision deadlines.',
        href: '/fun/alerts',
        prompt: 'Help me set reminders for trip prep, bookings, and fun plans.',
      },
    ],
  },
  {
    id: 'social',
    title: 'People',
    description: 'Friends, family, birthdays, groups, and follow-ups.',
    prompts: [
      {
        id: 'social.people',
        label: 'People',
        detail: 'Important people and relationship context.',
        href: '/social/people',
        prompt: 'Help me set up important people and what Alfred should remember about them.',
      },
      {
        id: 'social.groups',
        label: 'Groups',
        detail: 'Friend groups, teams, neighbors, and family circles.',
        href: '/social/groups',
        prompt: 'Help me organize people into household groups and circles.',
      },
      {
        id: 'social.calendar',
        label: 'Social calendar',
        detail: 'Birthdays, anniversaries, and plans.',
        href: '/social/calendar',
        prompt: 'Help me capture birthdays, anniversaries, and social plans.',
      },
      {
        id: 'social.alerts',
        label: 'Reach-outs',
        detail: 'Who to check in with and when.',
        href: '/social/alerts',
        prompt: 'Help me set up reminders for gifts, check-ins, and hosting follow-ups.',
      },
    ],
  },
];

export const ONBOARDING_START_PROMPTS: readonly OnboardingStartPrompt[] = [
  {
    id: 'guided',
    label: 'Ask what matters first',
    detail: 'Money, meals, plans, or people.',
    prompt:
      'Ask what I want HomeHub to handle first, then use your HomeHub onboarding skill to collect the key details.',
  },
  {
    id: 'week',
    label: 'Set up this week',
    detail: 'Plans, calendar items, and open decisions.',
    prompt:
      'Start with this week: plans, calendar items, bills, meals, and any decisions that need a yes.',
  },
  {
    id: 'food',
    label: 'Meals first',
    detail: 'Dinner rhythm, pantry, and groceries.',
    prompt:
      'Start with food: our meal rhythm, pantry staples, grocery needs, and dishes worth remembering.',
  },
  {
    id: 'money',
    label: 'Bills first',
    detail: 'Accounts, subscriptions, and due dates.',
    prompt:
      'Start with money: accounts, recurring bills, subscriptions, budgets, and upcoming due dates.',
  },
  {
    id: 'people',
    label: 'People first',
    detail: 'Family, friends, birthdays, and follow-ups.',
    prompt:
      'Start with people: important family and friends, birthdays, groups, and follow-ups worth remembering.',
  },
];

const ALL_PROMPTS = SETUP_SECTIONS.flatMap((section) =>
  section.prompts.map((prompt) => ({
    ...prompt,
    segment: section.id,
    sectionTitle: section.title,
  })),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSegmentId(value: unknown): value is SegmentId {
  return typeof value === 'string' && SEGMENT_ORDER.includes(value as SegmentId);
}

function isSetupSurfaceId(value: unknown): value is SetupSurfaceId {
  return typeof value === 'string' && SETUP_SURFACE_ORDER.includes(value as SetupSurfaceId);
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function onboardingSettings(settings: unknown): Record<string, unknown> | null {
  if (!isRecord(settings)) return null;
  const onboarding = settings.onboarding;
  return isRecord(onboarding) ? onboarding : null;
}

export function hasStoredSetup(settings: unknown): boolean {
  const onboarding = onboardingSettings(settings);
  return onboarding ? Object.prototype.hasOwnProperty.call(onboarding, 'setup_segments') : false;
}

export function getConfiguredSetupSegments(settings: unknown): SegmentId[] {
  const onboarding = onboardingSettings(settings);
  if (!onboarding || !Array.isArray(onboarding.setup_segments)) return [...SEGMENT_ORDER];
  return unique(onboarding.setup_segments.filter(isSegmentId));
}

export function getSelectedSetupPromptIds(settings: unknown): string[] {
  const onboarding = onboardingSettings(settings);
  if (!onboarding || !Array.isArray(onboarding.setup_prompt_ids)) return [];
  return unique(onboarding.setup_prompt_ids.filter((id): id is string => typeof id === 'string'));
}

export function getConfiguredSetupSurfaces(settings: unknown): SetupSurfaceId[] {
  if (!hasStoredSetup(settings)) return [...SETUP_SURFACE_ORDER];

  const onboarding = onboardingSettings(settings);
  if (!onboarding) return [];

  const explicit = Array.isArray(onboarding.setup_surface_ids)
    ? unique(onboarding.setup_surface_ids.filter(isSetupSurfaceId))
    : [];
  const visible = new Set<SetupSurfaceId>(explicit);

  for (const promptId of getSelectedSetupPromptIds(settings)) {
    if (promptId.endsWith('.calendar')) visible.add('calendar');
  }

  return SETUP_SURFACE_ORDER.filter((id) => visible.has(id));
}

export function getVisibleSetupHrefs(
  settings: unknown,
  segment: SegmentId,
): readonly string[] | null {
  if (!hasStoredSetup(settings)) return null;
  const promptIds = new Set(getSelectedSetupPromptIds(settings));
  const section = SETUP_SECTIONS.find((s) => s.id === segment);
  if (!section) return [];
  return section.prompts.filter((prompt) => promptIds.has(prompt.id)).map((prompt) => prompt.href);
}

export function chatPromptHref(prompt: string): string {
  return `/chat/new?prompt=${encodeURIComponent(prompt)}`;
}

export function buildHermesOnboardingStartPrompt({
  householdName,
  promptId,
}: {
  householdName: string;
  promptId?: string;
}): string {
  const selected =
    ONBOARDING_START_PROMPTS.find((prompt) => prompt.id === promptId) ??
    ONBOARDING_START_PROMPTS[0]!;

  return [
    `Alfred, start HomeHub onboarding for ${householdName || 'my household'}.`,
    selected.prompt,
    'Ask one follow-up at a time. Once you have enough to create something useful, populate the matching HomeHub data.',
    'Only reveal Calendar, Decisions, sections, or tabs when there is information worth showing.',
  ].join('\n\n');
}

export function buildAlfredSetupPrompt({
  householdName,
  selectedSegmentIds,
  selectedPromptIds,
}: {
  householdName: string;
  selectedSegmentIds: readonly SegmentId[];
  selectedPromptIds: readonly string[];
}): string | null {
  const segments = unique(selectedSegmentIds);
  if (segments.length === 0) return null;

  const promptIds = new Set(selectedPromptIds);
  const selectedPrompts = ALL_PROMPTS.filter((prompt) => promptIds.has(prompt.id));
  const sectionLabels = segments.map((id) => SEGMENTS[id].label).join(', ');
  const lines = selectedPrompts.map((prompt) => `- ${prompt.sectionTitle}: ${prompt.prompt}`);
  const focus =
    lines.length > 0
      ? `Start with these areas:\n${lines.join('\n')}`
      : `Start by asking which ${sectionLabels} details matter most.`;

  return [
    `Alfred, help me set up HomeHub for ${householdName || 'my household'}.`,
    `Focus on: ${sectionLabels}.`,
    focus,
    'Use your HomeHub onboarding skill. Ask one follow-up at a time, create useful HomeHub records when you can, and only reveal Calendar, Decisions, sections, or tabs when there is information worth showing.',
  ].join('\n\n');
}
