/**
 * Bridge between Next.js's async `cookies()` store and the
 * `CookieAdapter` shape `@homehub/auth-server` expects.
 *
 * Next's App Router returns cookies through an async accessor. The
 * auth-server's `CookieAdapter` is synchronous (it mirrors Supabase SSR's
 * expectation). We materialize the cookies at the top of each server
 * action invocation and hand the snapshot to auth-server calls; the
 * `setAll` side is bound to the same request-scoped cookie store and
 * writes back through it.
 */

import { type CookieAdapter } from '@homehub/auth-server';
import { cookies } from 'next/headers';

export async function nextCookieAdapter(): Promise<CookieAdapter> {
  const store = await cookies();
  return {
    getAll() {
      return store.getAll().map((c) => ({ name: c.name, value: c.value }));
    },
    setAll(toSet) {
      try {
        for (const { name, value, options } of toSet) {
          // Next's cookieStore.set accepts (name, value, Partial<ResponseCookie>).
          // The auth-server CookieAdapter's options are untyped (Record<string, unknown>);
          // Supabase SSR populates them with the same field shape.
          (store.set as (n: string, v: string, o: Record<string, unknown>) => void)(
            name,
            value,
            options ?? {},
          );
        }
      } catch {
        // Server Component context: writes not allowed. Supabase SSR
        // swallows this too — the middleware / action path writes back.
      }
    },
  };
}
