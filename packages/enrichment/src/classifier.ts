/**
 * Deterministic, ordered-rules event classifier.
 *
 * Spec: `specs/04-memory-network/extraction.md` (the atomicity rule and
 * "structured output" discipline) + the M2-B dispatch brief.
 *
 * Strategy: first-match-wins across an ordered list of rule groups. The
 * order is deliberately:
 *
 *   1. Social first. Birthdays/anniversaries and similar occasions
 *      otherwise get swallowed by the broader "fun" keywords (e.g.
 *      "birthday party" would match `party` under fun). The dispatch
 *      explicitly called this out.
 *   2. Financial. Bill / subscription keywords.
 *   3. Food. Restaurants, reservations, grocery, meal prep.
 *   4. Fun. Concerts, trips, movies, games.
 *   5. Attendee-driven social fallback. If an external attendee is on
 *      the event and no keyword rule fired, this is probably a social
 *      touch-point (coffee, call, catch up).
 *   6. System. The "not classified" sentinel at 0.2 confidence.
 *
 * The classifier is pure — same input, same output — so re-running on
 * the same event row is safe. The worker relies on this for idempotency.
 */

import {
  DETERMINISTIC_CLASSIFIER_VERSION,
  type EventClassification,
  type EventClassifier,
  type EventInput,
  type EventKind,
  type EventSegment,
} from './types.js';

interface NormalizedEvent {
  title: string;
  description: string;
  location: string;
  haystack: string;
  attendees: EventInput['attendees'];
  allDay: boolean;
  ownerEmail: string;
}

interface RuleMatch {
  signal: string;
  strong: boolean;
}

interface ClassificationDraft {
  segment: EventSegment;
  signals: RuleMatch[];
}

/** Whole-word-ish regex. Uses lookarounds over `\b` so it matches around
 * punctuation (`1:1`, `OpenTable:`, `birthday!`). `flags='i'` is always
 * applied. */
function keyword(term: string): RegExp {
  // Escape regex metacharacters in the term so callers can pass strings
  // like `1:1` without having to hand-escape.
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
}

interface Rule {
  /** Rule name — emitted into `signals`. */
  name: string;
  /** If `true`, matches here are "strong" → 0.9 confidence. Otherwise
   * they are "weak" → 0.6 confidence when only weak rules fired. */
  strong: boolean;
  test: (ev: NormalizedEvent) => boolean;
}

interface RuleGroup {
  segment: EventSegment;
  rules: Rule[];
}

/** Utility: any of these patterns in the haystack? */
function anyOf(terms: string[]): (ev: NormalizedEvent) => boolean {
  const patterns = terms.map(keyword);
  return (ev) => patterns.some((p) => p.test(ev.haystack));
}

/** Utility: any of these patterns in the location field? */
function anyOfLocation(terms: string[]): (ev: NormalizedEvent) => boolean {
  const patterns = terms.map(keyword);
  return (ev) => patterns.some((p) => p.test(ev.location));
}

// ---- Social ------------------------------------------------------------
// Social rules run before fun so "birthday party" classifies as social.

const SOCIAL_STRONG_KEYWORDS = [
  'birthday',
  'anniversary',
  'wedding',
  'baby shower',
  'bridal shower',
  'reunion',
  'playdate',
  'housewarming',
  'funeral',
  'memorial',
];

const SOCIAL_WEAK_KEYWORDS = [
  'visit',
  'coffee',
  'catch up',
  'catch-up',
  'call with',
  'drinks with',
  'happy hour',
];

const socialRules: Rule[] = [
  {
    name: 'social.keyword.strong',
    strong: true,
    test: anyOf(SOCIAL_STRONG_KEYWORDS),
  },
  {
    name: 'social.keyword.weak',
    strong: false,
    test: anyOf(SOCIAL_WEAK_KEYWORDS),
  },
];

// ---- Financial ---------------------------------------------------------

const FINANCIAL_STRONG_KEYWORDS = [
  'bill',
  'bills',
  'payment due',
  'rent',
  'mortgage',
  'invoice',
  'tax',
  'taxes',
  'renewal',
  'subscription',
  'auto-pay',
  'autopay',
  'statement',
  'due date',
];

const FINANCIAL_LOCATION_KEYWORDS = ['bank', 'credit union', 'atm', 'wells fargo', 'chase'];

const financialRules: Rule[] = [
  {
    name: 'financial.keyword.strong',
    strong: true,
    test: anyOf(FINANCIAL_STRONG_KEYWORDS),
  },
  {
    name: 'financial.location',
    strong: true,
    test: anyOfLocation(FINANCIAL_LOCATION_KEYWORDS),
  },
];

// ---- Food --------------------------------------------------------------

const FOOD_STRONG_KEYWORDS = [
  'dinner',
  'lunch',
  'brunch',
  'breakfast',
  'reservation',
  'opentable',
  'resy',
  'meal prep',
  'grocery',
  'groceries',
  'farmers market',
  'potluck',
];

// Cuisine / common food words that signal but aren't enough on their own.
const FOOD_WEAK_KEYWORDS = [
  'pizza',
  'sushi',
  'ramen',
  'tacos',
  'bbq',
  'barbecue',
  'bakery',
  'wine tasting',
  'tasting menu',
];

const FOOD_LOCATION_KEYWORDS = [
  'restaurant',
  'cafe',
  'café',
  'diner',
  'bistro',
  'brewery',
  'tavern',
  'trattoria',
  'pizzeria',
];

const foodRules: Rule[] = [
  {
    name: 'food.keyword.strong',
    strong: true,
    test: anyOf(FOOD_STRONG_KEYWORDS),
  },
  {
    name: 'food.location',
    strong: true,
    test: anyOfLocation(FOOD_LOCATION_KEYWORDS),
  },
  {
    name: 'food.keyword.weak',
    strong: false,
    test: anyOf(FOOD_WEAK_KEYWORDS),
  },
];

// ---- Fun ---------------------------------------------------------------

const FUN_STRONG_KEYWORDS = [
  'concert',
  'ticket',
  'tickets',
  'show',
  'movie',
  'museum',
  'gallery',
  'game',
  'trip',
  'flight',
  'hotel',
  'airbnb',
  'disney',
  'national park',
  'vacation',
  'holiday',
  'party',
  'festival',
  'theater',
  'theatre',
];

const funRules: Rule[] = [
  {
    name: 'fun.keyword.strong',
    strong: true,
    test: anyOf(FUN_STRONG_KEYWORDS),
  },
];

// ---- Meeting / work marker --------------------------------------------
// Meetings stay in 'system' by default (HomeHub cares about households,
// not work calendars), but we record the `kind` so downstream consumers
// can filter on it if needed.

const MEETING_KEYWORDS = [
  'meeting',
  '1:1',
  'one-on-one',
  'sync',
  'standup',
  'stand-up',
  'retro',
  'kickoff',
  'kick-off',
  'all hands',
  'all-hands',
  'interview',
];

const meetingPattern = anyOf(MEETING_KEYWORDS);

// ---- Ordered dispatch list --------------------------------------------

const RULE_GROUPS: RuleGroup[] = [
  { segment: 'social', rules: socialRules },
  { segment: 'financial', rules: financialRules },
  { segment: 'food', rules: foodRules },
  { segment: 'fun', rules: funRules },
];

// ---- Kind heuristics --------------------------------------------------

function pickKind(ev: NormalizedEvent, segment: EventSegment, signals: RuleMatch[]): EventKind {
  const sigNames = new Set(signals.map((s) => s.signal));

  // Birthday / anniversary: prefer the exact match when the keyword is
  // there. "Birthday" wins over "anniversary" if both appear because
  // downstream reminder semantics differ; document in fixtures.
  if (sigNames.has('social.keyword.strong')) {
    if (/birthday/i.test(ev.haystack)) return 'birthday';
    if (/anniversary/i.test(ev.haystack)) return 'anniversary';
    if (
      /wedding|baby shower|bridal shower|housewarming|reunion|funeral|memorial/i.test(ev.haystack)
    ) {
      return 'unknown';
    }
    if (/playdate/i.test(ev.haystack)) return 'unknown';
  }

  // Travel: flights / hotels / "trip" → travel. Hotel only wins if
  // explicit (weak spots like "hotel lobby" still match, which is fine
  // for segment but kind stays 'travel' because that's the strongest
  // signal available).
  if (/\b(flight|hotel|airbnb|trip|vacation|national park|disney)\b/i.test(ev.haystack)) {
    return 'travel';
  }

  // Reservation: OpenTable, Resy, or the word "reservation".
  if (/\b(opentable|resy|reservation)\b/i.test(ev.haystack)) {
    return 'reservation';
  }

  // Financial sub-kinds. Check 'bill' first: "Auto-pay runs tonight" in
  // the description of a bill event should not flip the kind to
  // 'subscription' when the title is obviously about a bill.
  if (segment === 'financial') {
    if (
      /\b(bill|bills|rent|mortgage|invoice|tax(es)?|payment due|statement|due date)\b/i.test(
        ev.haystack,
      )
    ) {
      return 'bill';
    }
    if (/\b(subscription|renewal|auto[- ]?pay)\b/i.test(ev.haystack)) return 'subscription';
  }

  // Meeting marker (regardless of segment).
  if (meetingPattern(ev)) return 'meeting';

  return 'unknown';
}

// ---- Normalization -----------------------------------------------------

function normalize(input: EventInput): NormalizedEvent {
  const title = input.title?.trim() ?? '';
  const description = input.description?.trim() ?? '';
  const location = input.location?.trim() ?? '';
  // Haystack is a single lower-cased string the rules scan. We keep
  // title/description/location readable separately so location-only
  // rules don't bleed into title-only semantics.
  const haystack = [title, description, location].filter(Boolean).join('\n');
  return {
    title,
    description,
    location,
    haystack,
    attendees: input.attendees,
    allDay: input.allDay,
    ownerEmail: input.ownerEmail.toLowerCase(),
  };
}

// ---- Attendee-driven social fallback ----------------------------------

/**
 * Returns true when the event has at least one attendee whose email is
 * not the owner's — a reasonable "external party" signal that pushes
 * the event to `'social'` when nothing else fires. Per M2-B scope we
 * can't hit the DB to check household membership, so owner-email is the
 * only proxy we have; M3's model path will do proper person resolution.
 */
function hasExternalAttendee(ev: NormalizedEvent): boolean {
  const owner = ev.ownerEmail;
  return ev.attendees.some((a) => a.email.toLowerCase() !== owner);
}

// ---- Main --------------------------------------------------------------

function runGroups(ev: NormalizedEvent): ClassificationDraft | null {
  for (const group of RULE_GROUPS) {
    const matches: RuleMatch[] = [];
    for (const rule of group.rules) {
      if (rule.test(ev)) {
        matches.push({ signal: rule.name, strong: rule.strong });
      }
    }
    if (matches.length > 0) {
      return { segment: group.segment, signals: matches };
    }
  }
  return null;
}

function buildRationale(ev: NormalizedEvent, signals: RuleMatch[]): string {
  const parts: string[] = [];
  for (const s of signals) parts.push(`matched rule ${s.signal}`);
  if (ev.attendees.length > 0) parts.push(`attendee count ${ev.attendees.length}`);
  if (ev.allDay) parts.push('all-day event');
  return parts.join('; ');
}

function confidenceFor(signals: RuleMatch[]): number {
  if (signals.some((s) => s.strong)) return 0.9;
  if (signals.length > 0) return 0.6;
  return 0.2;
}

export function createDeterministicEventClassifier(): EventClassifier {
  return {
    classify(event: EventInput): EventClassification {
      const ev = normalize(event);

      const groupMatch = runGroups(ev);
      if (groupMatch) {
        const segment = groupMatch.segment;
        const signals = groupMatch.signals;
        const kind = pickKind(ev, segment, signals);
        return {
          segment,
          kind,
          confidence: confidenceFor(signals),
          rationale: buildRationale(ev, signals),
          signals: signals.map((s) => s.signal),
        };
      }

      // No keyword rule fired. Try the attendee fallback before giving up.
      if (hasExternalAttendee(ev)) {
        const signals: RuleMatch[] = [{ signal: 'social.attendee-fallback', strong: false }];
        const kind = meetingPattern(ev) ? 'meeting' : 'unknown';
        return {
          segment: 'social',
          kind,
          confidence: confidenceFor(signals),
          rationale: buildRationale(ev, signals),
          signals: signals.map((s) => s.signal),
        };
      }

      // Meetings without any attendee still land in system; record the
      // kind so consumers that care can find them.
      const kind: EventKind = meetingPattern(ev) ? 'meeting' : 'unknown';
      const signals: RuleMatch[] = [{ signal: 'system.fallthrough', strong: false }];
      return {
        segment: 'system',
        kind,
        confidence: 0.2,
        rationale: buildRationale(ev, signals),
        signals: signals.map((s) => s.signal),
      };
    },
  };
}

export { DETERMINISTIC_CLASSIFIER_VERSION };
