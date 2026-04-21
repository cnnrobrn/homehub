/**
 * Sentry bootstrap for the web app.
 *
 * Server-only. Loads `@sentry/nextjs` dynamically when
 * `NEXT_PUBLIC_SENTRY_DSN` is set; no-ops otherwise. The web app can
 * ship without the Sentry SDK installed — `@sentry/nextjs` is a
 * deliberate runtime-optional dependency so dev installs stay small.
 *
 * Wiring:
 *   - Call `initWebSentry()` from a Server Component (e.g. the root
 *     `layout.tsx`) during cold-start so SSR exceptions are captured.
 *   - A second call from the same process is idempotent.
 *
 * Client-side wiring (browser-bundle) lives separately in
 * `apps/web/sentry.client.config.ts` when/if the SDK is added; this
 * file only covers SSR + route-handler contexts.
 */

import { publicEnv } from '@/lib/env';

let initialized = false;

export async function initWebSentry(): Promise<void> {
  if (initialized) return;
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? publicEnv.NEXT_PUBLIC_SUPABASE_URL;
  const realDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!realDsn) {
    // Swallow silently in dev; avoid noisy log-on-every-page in prod.
    initialized = true;
    return;
  }
  void dsn;
  try {
    // Indirect dynamic import so TypeScript does not attempt to resolve
    // the `@sentry/nextjs` types when the optional peer isn't installed.
    const name = '@sentry/nextjs';
    const sentry = (await (
      new Function('m', 'return import(m)') as (m: string) => Promise<unknown>
    )(name)) as { init(opts: Record<string, unknown>): void };
    sentry.init({
      dsn: realDsn,
      environment: process.env.NODE_ENV,
      tracesSampleRate: Number.parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0') || 0,
    });
    initialized = true;
  } catch {
    // Log a one-line notice via stdout so ops sees it during boot;
    // avoid using the structured logger here — web hasn't instantiated
    // one in this path.
    process.stdout.write('[web] sentry init skipped: @sentry/nextjs not installed\n');
    initialized = true;
  }
}
