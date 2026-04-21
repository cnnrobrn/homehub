/**
 * `@homehub/providers-calendar` — public surface.
 *
 * Keep this barrel tight. Consumers:
 *   - `apps/workers/sync-gcal` imports `createGoogleCalendarProvider` and
 *     the error classes.
 *   - `apps/workers/webhook-ingest` imports the provider to call
 *     `watch` / `unwatch` on the Nango-webhook path.
 *   - Future adapters (Outlook, iCal) export alongside Google here.
 */

export { CalendarSyncError, FullResyncRequiredError, RateLimitError } from './errors.js';

export {
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

export {
  GOOGLE_CALENDAR_PROVIDER_KEY,
  createGoogleCalendarProvider,
  type CreateGoogleCalendarProviderArgs,
} from './google.js';
