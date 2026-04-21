/**
 * `@homehub/providers-email/client` — client-safe subset of the public
 * surface.
 *
 * Imports nothing that depends on Node-only APIs (no worker-runtime,
 * no Nango SDK), so this file is safe to pull into React client
 * components and Next.js app router browser bundles.
 *
 * The split mirrors Next's general rule: anything a Client Component
 * imports must not drag in server-only deps. The full provider adapter
 * is still exported from the package root for the sync-gmail worker and
 * the webhook-ingest service.
 */

export type { EmailCategory } from './types.js';
export { ALL_EMAIL_CATEGORIES } from './types.js';

export {
  buildGmailQuery,
  CATEGORY_FILTERS,
  describeCategories,
  isEmailCategory,
  type BuildQueryArgs,
  type CategoryFilter,
} from './query.js';
