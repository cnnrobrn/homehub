/**
 * `@homehub/db` — Supabase migrations and generated database types.
 *
 * This package owns the SQL schema. Consumers import `Database` for typed
 * Supabase clients and `LOCAL_DATABASE_URL` when they need to connect to
 * the local Supabase stack booted by `pnpm --filter @homehub/db db:start`.
 *
 * The Supabase *service client* is not instantiated here — that belongs
 * to `packages/worker-runtime` (M0-C). This package is schema-only.
 */

export type { Database, Json } from './types.generated.js';

/**
 * Connection string for the local Supabase Postgres, as booted by
 * `supabase start`. The port and credentials are the Supabase CLI defaults
 * and match `supabase/config.toml` in this package. Local development only;
 * staging and production connection strings come from environment variables
 * set at deploy time, not from this package.
 */
export const LOCAL_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
