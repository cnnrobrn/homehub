/**
 * Browser-side Supabase client factory.
 *
 * Used ONLY by Client Components that need Supabase realtime
 * subscriptions. Reads still flow through Server Components and props;
 * per `specs/07-frontend/ui-architecture.md` the rule is "no direct
 * Supabase queries from React components."
 *
 * This file is safe to import from client code because it touches only
 * the `NEXT_PUBLIC_*` env subset. Never import `@/lib/env`'s `serverEnv`
 * here — that would pull the service-role key into the client bundle.
 */

'use client';

import { type Database } from '@homehub/db';
import { createBrowserClient } from '@supabase/ssr';
import { type SupabaseClient } from '@supabase/supabase-js';

import { publicEnv } from '@/lib/env';

export type BrowserSupabaseClient = SupabaseClient<Database>;

export function createClient(): BrowserSupabaseClient {
  return createBrowserClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
