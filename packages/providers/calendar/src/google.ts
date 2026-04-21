/**
 * Google Calendar provider adapter.
 *
 * Speaks Google Calendar v3 through Nango's proxy. Zero direct token
 * handling — Nango owns OAuth refresh (`specs/03-integrations/nango.md`).
 *
 * Design notes:
 *   - `listEvents` is an async generator that yields one page at a time.
 *     The worker upserts per-page so a failure mid-pagination still
 *     commits the pages already emitted. The final page carries
 *     `nextSyncToken`; earlier pages do not.
 *   - When Google returns `410 Gone` on a `syncToken`, we throw
 *     `FullResyncRequiredError`. The token is dead and the caller must
 *     trigger a full sync (Google's docs are explicit — sync tokens can
 *     expire even within the documented 7-day window).
 *   - 429 / 403-with-quotaExceeded map to `RateLimitError` carrying the
 *     `Retry-After` seconds. The worker `nack`s with a matching
 *     visibility bump.
 *   - Attendees are deduped by lower-cased email. Google occasionally
 *     returns the same invitee twice (organizer vs. optional attendee
 *     entries).
 */

import { type NangoClient, NangoError } from '@homehub/worker-runtime';

import { CalendarSyncError, FullResyncRequiredError, RateLimitError } from './errors.js';
import {
  type CalendarAttendee,
  type CalendarEvent,
  type CalendarProvider,
  type CreateEventArgs,
  type CreateEventResult,
  type ListEventsArgs,
  type ListEventsPage,
  type UnwatchArgs,
  type WatchArgs,
  type WatchResult,
} from './types.js';

/** Nango provider-config key for Google Calendar. Fixed by convention. */
export const GOOGLE_CALENDAR_PROVIDER_KEY = 'google-calendar';

/** Google sets `Retry-After` in seconds; if missing, default to 60s. */
const DEFAULT_RATE_LIMIT_RETRY_SECONDS = 60;

/** Page size matches Google's default; keeps round-trips bounded. */
const PAGE_SIZE = 250;

// --- Narrow Google API response shapes. We only pull fields we use; the
// raw response is preserved on `metadata`.

interface RawAttendee {
  email?: string;
  displayName?: string;
  responseStatus?: string;
}

interface RawEventDateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

interface RawEvent {
  id?: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: RawEventDateTime;
  end?: RawEventDateTime;
  attendees?: RawAttendee[];
  recurringEventId?: string;
  [key: string]: unknown;
}

interface RawListResponse {
  items?: RawEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
  summary?: string;
  [key: string]: unknown;
}

interface RawCalendarPrimary {
  id?: string;
  /** Calendar owner's email. For a user's primary calendar this equals the account email. */
  summary?: string;
  [key: string]: unknown;
}

interface RawChannel {
  id?: string;
  resourceId?: string;
  expiration?: string;
}

/**
 * Extracts seconds from an HTTP Retry-After header value. Accepts either
 * a relative delta in seconds or an HTTP-date. Caps via
 * `RateLimitError`'s own clamp.
 */
function parseRetryAfter(value: string | undefined): number {
  if (!value) return DEFAULT_RATE_LIMIT_RETRY_SECONDS;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;
  const asDate = Date.parse(value);
  if (Number.isFinite(asDate)) {
    const diff = Math.ceil((asDate - Date.now()) / 1_000);
    if (diff > 0) return diff;
  }
  return DEFAULT_RATE_LIMIT_RETRY_SECONDS;
}

/**
 * Inspects a thrown error from Nango's proxy and maps provider-shape
 * Google API errors to our typed errors. We preserve the cause chain so
 * Sentry / logs can show the upstream response.
 */
function classifyNangoError(err: unknown): never {
  if (err instanceof NangoError) {
    const cause = err.cause as
      | {
          response?: {
            status?: number;
            statusText?: string;
            headers?: Record<string, string>;
            data?: {
              error?: {
                code?: number;
                status?: string;
                message?: string;
                errors?: Array<{ reason?: string }>;
              };
            };
          };
        }
      | undefined;
    const status = cause?.response?.status;
    const data = cause?.response?.data;
    const reasons = data?.error?.errors?.map((e) => e?.reason).filter(Boolean) ?? [];

    // 410 Gone: syncToken invalidated.
    if (status === 410) {
      throw new FullResyncRequiredError('google returned 410; sync token invalidated', {
        cause: err,
      });
    }
    // 429 or 403 with quotaExceeded / rateLimitExceeded reasons.
    const quotaReason = reasons.some(
      (r) => r === 'rateLimitExceeded' || r === 'userRateLimitExceeded' || r === 'quotaExceeded',
    );
    if (status === 429 || (status === 403 && quotaReason)) {
      const retryAfter = parseRetryAfter(cause?.response?.headers?.['retry-after']);
      throw new RateLimitError('google rate limit exceeded', retryAfter, { cause: err });
    }
  }
  throw new CalendarSyncError('google calendar proxy call failed', { cause: err });
}

/**
 * Deduplicate attendees by lower-cased email. Preserves first occurrence
 * (Google orders organizer first, which is what we want on metadata).
 */
function dedupAttendees(raw: RawAttendee[] | undefined): CalendarAttendee[] {
  if (!raw) return [];
  const seen = new Map<string, CalendarAttendee>();
  for (const a of raw) {
    const email = (a.email ?? '').trim().toLowerCase();
    if (!email) continue;
    if (seen.has(email)) continue;
    const responseStatus = (() => {
      switch (a.responseStatus) {
        case 'accepted':
        case 'declined':
        case 'tentative':
        case 'needsAction':
          return a.responseStatus;
        default:
          return undefined;
      }
    })();
    seen.set(email, {
      email,
      ...(a.displayName ? { displayName: a.displayName } : {}),
      ...(responseStatus ? { responseStatus } : {}),
    });
  }
  return [...seen.values()];
}

/**
 * Convert Google's `{ date?, dateTime? }` into an ISO-8601-with-offset
 * string. All-day events collapse to midnight UTC of the date.
 */
function toIso(dt: RawEventDateTime | undefined): { iso: string | undefined; allDay: boolean } {
  if (!dt) return { iso: undefined, allDay: false };
  if (dt.dateTime) {
    return { iso: dt.dateTime, allDay: false };
  }
  if (dt.date) {
    return { iso: `${dt.date}T00:00:00.000Z`, allDay: true };
  }
  return { iso: undefined, allDay: false };
}

function normalizeEvent(raw: RawEvent, ownerEmail: string): CalendarEvent | null {
  if (!raw.id) return null;
  const { iso: startIso, allDay: startAllDay } = toIso(raw.start);
  const { iso: endIso, allDay: endAllDay } = toIso(raw.end);
  if (!startIso) return null;
  const allDay = startAllDay || endAllDay;

  const status = (() => {
    switch (raw.status) {
      case 'confirmed':
      case 'tentative':
      case 'cancelled':
        return raw.status;
      default:
        return 'confirmed';
    }
  })();

  // Strip fields we already normalize; preserve the rest on metadata so
  // backfill can recover anything we didn't map.
  const {
    id: _id,
    etag: _etag,
    summary: _summary,
    description: _description,
    location: _location,
    start: _start,
    end: _end,
    attendees: _attendees,
    status: _status,
    recurringEventId: _recurringEventId,
    ...metadata
  } = raw;

  return {
    sourceId: raw.id,
    sourceVersion: raw.etag ?? '',
    title: raw.summary ?? '(untitled event)',
    startsAt: startIso,
    ...(endIso ? { endsAt: endIso } : {}),
    allDay,
    ...(raw.location ? { location: raw.location } : {}),
    ...(raw.description ? { description: raw.description } : {}),
    attendees: dedupAttendees(raw.attendees),
    ownerEmail,
    ...(raw.recurringEventId ? { recurringEventId: raw.recurringEventId } : {}),
    status,
    metadata,
  };
}

export interface CreateGoogleCalendarProviderArgs {
  nango: NangoClient;
  /**
   * Logger-compatible. Optional; the adapter itself is quiet — the worker
   * logs boundaries. Pass in if you want provider-level trace lines.
   */
  log?: {
    debug?: (msg: string, ctx?: Record<string, unknown>) => void;
  };
}

export function createGoogleCalendarProvider(
  args: CreateGoogleCalendarProviderArgs,
): CalendarProvider {
  const { nango, log } = args;

  // Per Google docs: the calendar owner's email equals the primary
  // calendar's `id`. We fetch it once per connection and cache for this
  // adapter instance. The worker constructs one adapter per process,
  // which is fine — connections are resolved by `connectionId` in the
  // closure signature, not captured here.
  const ownerEmailCache = new Map<string, string>();

  async function resolveOwnerEmail(connectionId: string): Promise<string> {
    const cached = ownerEmailCache.get(connectionId);
    if (cached) return cached;
    try {
      const data = await nango.proxy<RawCalendarPrimary>({
        providerConfigKey: GOOGLE_CALENDAR_PROVIDER_KEY,
        connectionId,
        method: 'GET',
        endpoint: '/calendar/v3/calendars/primary',
      });
      // For a user's primary calendar, `id` is the account email.
      const email = (data?.id ?? data?.summary ?? '').trim();
      if (!email) {
        throw new CalendarSyncError(
          `google primary calendar response missing owner email for connection ${connectionId}`,
        );
      }
      ownerEmailCache.set(connectionId, email);
      return email;
    } catch (err) {
      if (err instanceof CalendarSyncError) throw err;
      classifyNangoError(err);
    }
  }

  async function* listEvents(opts: ListEventsArgs): AsyncIterable<ListEventsPage> {
    const ownerEmail = await resolveOwnerEmail(opts.connectionId);
    let pageToken: string | undefined;
    let iterationGuard = 0;

    while (true) {
      iterationGuard += 1;
      if (iterationGuard > 200) {
        throw new CalendarSyncError('google calendar pagination exceeded 200 pages; aborting');
      }

      // When resuming with a syncToken, Google rejects `timeMin`/`timeMax`.
      // Use one OR the other.
      const params: Record<string, string | number> = {
        maxResults: PAGE_SIZE,
        singleEvents: 'true',
        showDeleted: 'true',
      };
      if (opts.syncToken) {
        params.syncToken = opts.syncToken;
      } else {
        params.timeMin = opts.timeMin;
        params.timeMax = opts.timeMax;
        params.orderBy = 'startTime';
      }
      if (pageToken) params.pageToken = pageToken;

      let response: RawListResponse;
      try {
        response = await nango.proxy<RawListResponse>({
          providerConfigKey: GOOGLE_CALENDAR_PROVIDER_KEY,
          connectionId: opts.connectionId,
          method: 'GET',
          endpoint: '/calendar/v3/calendars/primary/events',
          params,
        });
      } catch (err) {
        classifyNangoError(err);
      }

      log?.debug?.('google calendar page fetched', {
        connection_id: opts.connectionId,
        item_count: response.items?.length ?? 0,
        has_next_page: Boolean(response.nextPageToken),
        has_next_sync_token: Boolean(response.nextSyncToken),
      });

      const events: CalendarEvent[] = [];
      for (const raw of response.items ?? []) {
        const normalized = normalizeEvent(raw, ownerEmail);
        if (normalized) events.push(normalized);
      }

      if (response.nextPageToken) {
        // More pages. Don't emit a sync token yet — Google only returns
        // it on the terminal page.
        yield { events };
        pageToken = response.nextPageToken;
        continue;
      }

      // Terminal page. Yield even if empty so the caller can commit the
      // cursor.
      yield {
        events,
        ...(response.nextSyncToken ? { nextSyncToken: response.nextSyncToken } : {}),
      };
      return;
    }
  }

  async function watch(opts: WatchArgs): Promise<WatchResult> {
    if (!opts.channelId.startsWith('hh-gcal-')) {
      throw new CalendarSyncError(
        `watch channelId must start with "hh-gcal-"; got ${opts.channelId}`,
      );
    }
    try {
      const data = await nango.proxy<RawChannel>({
        providerConfigKey: GOOGLE_CALENDAR_PROVIDER_KEY,
        connectionId: opts.connectionId,
        method: 'POST',
        endpoint: '/calendar/v3/calendars/primary/events/watch',
        data: {
          id: opts.channelId,
          type: 'web_hook',
          address: opts.webhookUrl,
          ...(opts.ttlSeconds ? { params: { ttl: String(opts.ttlSeconds) } } : {}),
        },
      });
      if (!data.id || !data.resourceId || !data.expiration) {
        throw new CalendarSyncError(
          'google events.watch response missing id/resourceId/expiration',
        );
      }
      return {
        channelId: data.id,
        resourceId: data.resourceId,
        // Google returns expiration as ms-since-epoch as a string.
        expiration: new Date(Number(data.expiration)).toISOString(),
      };
    } catch (err) {
      if (err instanceof CalendarSyncError) throw err;
      classifyNangoError(err);
    }
  }

  async function createEvent(opts: CreateEventArgs): Promise<CreateEventResult> {
    const title = opts.title?.trim();
    if (!title) {
      throw new CalendarSyncError('createEvent: title is required');
    }
    if (!opts.startsAt) {
      throw new CalendarSyncError('createEvent: startsAt is required');
    }

    // Google events.insert requires both start and end. Default to a
    // 1-hour window if the caller omitted endsAt so the provider never
    // 400s on a missing field.
    const startsAt = opts.startsAt;
    const endsAt =
      opts.endsAt ?? new Date(new Date(opts.startsAt).getTime() + 60 * 60 * 1_000).toISOString();

    // De-dup attendees by lower-cased email. The provider is tolerant
    // of duplicates but we want deterministic output for tests.
    const attendees = Array.from(
      new Set((opts.attendees ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean)),
    ).map((email) => ({ email }));

    const body: Record<string, unknown> = {
      summary: title,
      start: { dateTime: startsAt },
      end: { dateTime: endsAt },
    };
    if (opts.location) body.location = opts.location;
    if (opts.description) body.description = opts.description;
    if (attendees.length > 0) body.attendees = attendees;

    try {
      const data = await nango.proxy<RawEvent & { htmlLink?: string }>({
        providerConfigKey: GOOGLE_CALENDAR_PROVIDER_KEY,
        connectionId: opts.connectionId,
        method: 'POST',
        endpoint: '/calendar/v3/calendars/primary/events',
        params: {
          // `sendUpdates=none` keeps the insert quiet; `all` mails every
          // invitee. Default to none to match HomeHub's "draft-first"
          // posture — the member can resend from their calendar UI.
          sendUpdates: opts.sendUpdates ? 'all' : 'none',
        },
        data: body,
      });
      if (!data.id) {
        throw new CalendarSyncError('google events.insert response missing id');
      }
      return {
        eventId: data.id,
        htmlLink: data.htmlLink ?? '',
      };
    } catch (err) {
      if (err instanceof CalendarSyncError) throw err;
      classifyNangoError(err);
    }
  }

  async function unwatch(opts: UnwatchArgs): Promise<void> {
    try {
      await nango.proxy({
        providerConfigKey: GOOGLE_CALENDAR_PROVIDER_KEY,
        connectionId: opts.connectionId,
        method: 'POST',
        endpoint: '/calendar/v3/channels/stop',
        data: { id: opts.channelId, resourceId: opts.resourceId },
      });
    } catch (err) {
      // `404` on stop is benign — the channel already expired. Surface
      // it quietly rather than raising.
      if (err instanceof NangoError) {
        const status = (err.cause as { response?: { status?: number } } | undefined)?.response
          ?.status;
        if (status === 404) return;
      }
      classifyNangoError(err);
    }
  }

  return { listEvents, watch, unwatch, createEvent };
}

/**
 * Exposed for tests. Given a raw Google event and the owner email,
 * produces the canonical shape. Kept separate from the adapter so
 * tests can pin normalization without mocking a full Nango client.
 */
export const __internal = { normalizeEvent, dedupAttendees, parseRetryAfter };
