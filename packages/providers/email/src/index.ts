/**
 * `@homehub/providers-email` — public surface.
 *
 * Consumers:
 *   - `apps/workers/sync-gmail` imports `createGoogleMailProvider`,
 *     the error classes, and the query builder.
 *   - `apps/workers/webhook-ingest` imports the provider to call
 *     `watch` / `unwatch` on the Nango-webhook path.
 *   - `apps/web` imports `ALL_EMAIL_CATEGORIES`, `CATEGORY_FILTERS`,
 *     `describeCategories`, and `isEmailCategory` for the privacy
 *     preview dialog and the `/api/integrations/connect` validator.
 *   - Future adapters (Outlook, IMAP) export alongside Google here.
 */

export { EmailSyncError, HistoryIdExpiredError, RateLimitError } from './errors.js';

export type {
  AddLabelArgs,
  EmailAttachmentMeta,
  EmailCategory,
  EmailMessage,
  EmailProvider,
  EnsureLabelArgs,
  EnsureLabelResult,
  FetchAttachmentArgs,
  FetchAttachmentResult,
  FetchMessageArgs,
  ListRecentMessagesArgs,
  ListRecentMessagesPage,
  UnwatchArgs,
  WatchArgs,
  WatchResult,
} from './types.js';

export { ALL_EMAIL_CATEGORIES } from './types.js';

export {
  buildGmailQuery,
  CATEGORY_FILTERS,
  describeCategories,
  isEmailCategory,
  type BuildQueryArgs,
  type CategoryFilter,
} from './query.js';

export {
  BODY_PREVIEW_MAX_BYTES,
  createGoogleMailProvider,
  GOOGLE_MAIL_PROVIDER_KEY,
  HOMEHUB_INGESTED_LABEL_NAME,
  type CreateGoogleMailProviderArgs,
} from './google.js';
