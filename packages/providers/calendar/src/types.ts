/**
 * Canonical calendar-event shape HomeHub stores in `app.event`.
 *
 * The shape is provider-agnostic on purpose: Google Calendar today, iCal
 * / Outlook post-v1. Fields below map directly to columns on `app.event`
 * plus `metadata` for provider-specific extras.
 *
 * Normalization rules:
 *   - `startsAt` / `endsAt` are always ISO-8601 with offset. All-day
 *     events fold to `YYYY-MM-DDT00:00:00.000Z` so downstream code can
 *     treat every event as a UTC timestamp without branching.
 *   - `attendees` is deduped by lower-cased email and preserves the
 *     provider's original display name and response status.
 *   - `metadata` is a jsonb dump of provider-specific fields the spec
 *     says we don't normalize (raw creator, conferencing, reminders).
 */

export interface CalendarAttendee {
  email: string;
  displayName?: string;
  responseStatus?: 'accepted' | 'declined' | 'tentative' | 'needsAction';
}

export interface CalendarEvent {
  /** Provider's stable event id (Google: `event.id`). */
  sourceId: string;
  /** Provider's change-detection token (Google: `event.etag`). */
  sourceVersion: string;
  title: string;
  /** ISO-8601 with offset. All-day events are midnight UTC of that day. */
  startsAt: string;
  endsAt?: string;
  allDay: boolean;
  location?: string;
  description?: string;
  attendees: CalendarAttendee[];
  /**
   * Calendar owner's email. Used by enrichment to anchor attendee
   * resolution to the right household member (`specs/03-integrations/
   * google-workspace.md#attendee--person-resolution`).
   */
  ownerEmail: string;
  /** Parent recurring-event id for recurrence instances. */
  recurringEventId?: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
  /** Provider extras kept verbatim for later re-normalization. */
  metadata: Record<string, unknown>;
}

export interface ListEventsArgs {
  connectionId: string;
  /** ISO-8601. Used only when `syncToken` is absent. */
  timeMin: string;
  timeMax: string;
  syncToken?: string;
}

export interface ListEventsPage {
  events: CalendarEvent[];
  /** Present on the final page; store and reuse on next delta sync. */
  nextSyncToken?: string;
}

export interface WatchArgs {
  connectionId: string;
  /**
   * HomeHub-owned channel id. Must prefix `hh-gcal-` so we can identify
   * our own channels in incoming webhooks without relying on shared
   * secrets.
   */
  channelId: string;
  webhookUrl: string;
  /** Optional TTL in seconds. Google caps channels at 7 days regardless. */
  ttlSeconds?: number;
}

export interface WatchResult {
  channelId: string;
  resourceId: string;
  /** ISO-8601. Google-assigned expiry, possibly sooner than requested. */
  expiration: string;
}

export interface UnwatchArgs {
  connectionId: string;
  channelId: string;
  resourceId: string;
}

/**
 * Args for creating a new event on the member's primary calendar.
 *
 * Used by the M9-B `add_to_calendar` executor family (draft-write
 * approvals that the member has accepted). The adapter inserts the
 * event via the provider's write API (Google: events.insert).
 *
 * Time fields:
 *   - `startsAt` / `endsAt` accept ISO-8601 timestamps with offsets
 *     (timed events). All-day shorthand is a future concern.
 *   - `endsAt` is optional; when absent, the adapter defaults to a
 *     1-hour window starting at `startsAt` so provider APIs that
 *     require an end time stay happy.
 *
 * Attendees are invited via the provider's standard attendee model.
 * The member's own email is added as the organizer implicitly by the
 * provider — do NOT pass it in `attendees`.
 */
export interface CreateEventArgs {
  connectionId: string;
  title: string;
  startsAt: string;
  endsAt?: string;
  location?: string;
  description?: string;
  attendees?: string[];
  /**
   * When true, the provider sends invitation emails to attendees. Default
   * false to match HomeHub's "draft-first" posture — the member can
   * decide later from their calendar UI.
   */
  sendUpdates?: boolean;
}

export interface CreateEventResult {
  /** Provider's stable event id. */
  eventId: string;
  /** Provider-hosted URL for the event (Google: `htmlLink`). */
  htmlLink: string;
}

/**
 * The narrow surface every calendar-provider adapter must implement.
 * Workers depend on this interface, not on a concrete provider — so a
 * future Outlook adapter drops in without touching sync code.
 */
export interface CalendarProvider {
  listEvents(args: ListEventsArgs): AsyncIterable<ListEventsPage>;
  watch(args: WatchArgs): Promise<WatchResult>;
  unwatch(args: UnwatchArgs): Promise<void>;
  /**
   * Create a new event on the member's primary calendar. Returns the
   * provider's event id + a `htmlLink` the UI can deep-link to.
   *
   * Used only by the M9-B `add_to_calendar` executor — the sync path
   * is read-only and does not call this method.
   */
  createEvent(args: CreateEventArgs): Promise<CreateEventResult>;
}
