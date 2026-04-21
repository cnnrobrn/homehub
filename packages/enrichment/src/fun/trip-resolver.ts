/**
 * Trip resolver — groups fun-segment sub-events (flights, hotels,
 * reservations, activities) under a shared parent `app.event` with
 * `kind='trip'`.
 *
 * Spec: `specs/06-segments/fun/calendar.md` — "A trip is represented as
 * a parent event with `kind='trip'` and sub-events linked via
 * `metadata.trip_id`." (The spec mentions `mem.edge type=part_of`; M7
 * chooses `metadata.trip_id` because it avoids a DB migration and the
 * fun calendar UI reads the pointer directly.)
 *
 * The resolver is a pure function over event inputs + existing trips.
 * The worker wires it to Supabase (loading candidate events, upserting
 * the parent trip, writing `metadata.trip_id` on children).
 *
 * Heuristics for what constitutes a "trip":
 *   - ≥3 sub-events clustered within a 5-day window.
 *   - Each sub-event's kind is one of the trip-ish kinds (flight, hotel,
 *     hotel_checkin, hotel_checkout, reservation, activity, concert,
 *     show).
 *   - Far-from-home is inferred implicitly: events with a non-null
 *     `location` that differ from the household's primary locale. For
 *     M7 we treat ANY cluster of ≥3 trip-ish events as a trip — without
 *     a `home_base` on the household row we can't reliably compare
 *     locations. Follow-up: add `app.household.settings.home_base` and
 *     tighten.
 *
 * Outputs are pure data. The worker is responsible for Supabase writes.
 */

const TRIP_ISH_KINDS = new Set([
  'flight',
  'hotel',
  'hotel_checkin',
  'hotel_checkout',
  'reservation',
  'activity',
  'concert',
  'show',
  'outing',
]);

const TRIP_WINDOW_DAYS = 5;
const TRIP_MIN_EVENTS = 3;

export interface TripResolverEvent {
  id: string;
  household_id: string;
  segment: string;
  kind: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  metadata: Record<string, unknown>;
}

export interface TripCandidate {
  /** UUID of the parent trip — either an existing one or a new one. */
  tripId: string;
  /** Whether this trip is a newly-proposed parent event. */
  isNew: boolean;
  /** Covered date window (ISO). */
  startsAt: string;
  endsAt: string;
  /** Human-friendly inferred label (first shared location when present). */
  title: string;
  /** Location field for the parent, when we can infer one. */
  location: string | null;
  /** IDs of child events to stamp with `metadata.trip_id = tripId`. */
  childEventIds: string[];
}

/**
 * Decide whether an incoming event should be attached to an existing
 * trip. Returns the trip id if yes, null otherwise.
 *
 * Matching rule: the event's `starts_at` falls inside any existing
 * trip's `[starts_at, ends_at]` window (inclusive). Non-fun events and
 * events that are already stamped with a `trip_id` are skipped.
 */
export function resolveTripParent(args: {
  event: TripResolverEvent;
  existingTrips: ReadonlyArray<TripResolverEvent>;
}): string | null {
  const { event, existingTrips } = args;
  if (event.segment !== 'fun') return null;
  if (typeof event.metadata?.trip_id === 'string' && event.metadata.trip_id.length > 0) {
    return event.metadata.trip_id;
  }
  const eventStart = new Date(event.starts_at).getTime();
  if (!Number.isFinite(eventStart)) return null;

  for (const trip of existingTrips) {
    if (trip.household_id !== event.household_id) continue;
    if (trip.kind !== 'trip') continue;
    const tripStart = new Date(trip.starts_at).getTime();
    const tripEnd = trip.ends_at ? new Date(trip.ends_at).getTime() : tripStart;
    if (!Number.isFinite(tripStart) || !Number.isFinite(tripEnd)) continue;
    if (eventStart >= tripStart && eventStart <= tripEnd) {
      return trip.id;
    }
  }
  return null;
}

/**
 * Given a batch of fun events (often the last ~30 days of gcal + manual
 * entries), return zero or more new trip parents that the worker should
 * materialize.
 *
 * Events already attached to an existing trip (`metadata.trip_id`
 * populated) are ignored.
 */
export function createTripFromEvents(args: {
  events: ReadonlyArray<TripResolverEvent>;
  householdId: string;
  /** Existing trip ids so we don't re-propose a window that's already covered. */
  existingTrips: ReadonlyArray<TripResolverEvent>;
  /** Pseudo-RNG for deterministic ids in tests. When absent, uses `crypto.randomUUID`. */
  idFactory?: () => string;
}): TripCandidate[] {
  const idFactory = args.idFactory ?? (() => globalThis.crypto.randomUUID());

  const candidates = args.events
    .filter((e) => e.household_id === args.householdId)
    .filter((e) => e.segment === 'fun')
    .filter((e) => TRIP_ISH_KINDS.has(e.kind))
    .filter((e) => e.kind !== 'trip')
    .filter((e) => !(typeof e.metadata?.trip_id === 'string' && e.metadata.trip_id.length > 0))
    .slice()
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());

  // Slide a 5-day window across the sorted list, greedily forming
  // clusters.
  const clusters: TripResolverEvent[][] = [];
  let current: TripResolverEvent[] = [];

  for (const event of candidates) {
    if (current.length === 0) {
      current.push(event);
      continue;
    }
    const firstStart = new Date(current[0]!.starts_at).getTime();
    const eventStart = new Date(event.starts_at).getTime();
    if (eventStart - firstStart <= TRIP_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
      current.push(event);
    } else {
      if (current.length >= TRIP_MIN_EVENTS) clusters.push(current);
      current = [event];
    }
  }
  if (current.length >= TRIP_MIN_EVENTS) clusters.push(current);

  const covered = new Set<string>();
  for (const trip of args.existingTrips) {
    covered.add(trip.id);
  }

  const out: TripCandidate[] = [];
  for (const cluster of clusters) {
    const startsAt = cluster[0]!.starts_at;
    const endsAt = cluster.reduce((max, e) => {
      const candidate = e.ends_at ?? e.starts_at;
      return candidate > max ? candidate : max;
    }, cluster[0]!.ends_at ?? cluster[0]!.starts_at);

    // Skip clusters already covered by an existing trip (any child
    // with a trip_id pointing at an existing trip).
    const alreadyHasTrip = cluster.some((c) => {
      const tid = c.metadata?.trip_id;
      return typeof tid === 'string' && covered.has(tid);
    });
    if (alreadyHasTrip) continue;

    const sharedLocation = cluster.find((c) => c.location)?.location ?? null;
    const title = sharedLocation ? `Trip to ${sharedLocation}` : 'Upcoming trip';

    out.push({
      tripId: idFactory(),
      isNew: true,
      startsAt,
      endsAt,
      title,
      location: sharedLocation,
      childEventIds: cluster.map((c) => c.id),
    });
  }

  return out;
}

export const TRIP_RESOLVER_WINDOW_DAYS = TRIP_WINDOW_DAYS;
export const TRIP_RESOLVER_MIN_EVENTS = TRIP_MIN_EVENTS;
export const TRIP_RESOLVER_KINDS = TRIP_ISH_KINDS;
