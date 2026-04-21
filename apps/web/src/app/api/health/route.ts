/**
 * GET /api/health
 *
 * Cheap liveness probe for Vercel, uptime monitors, and the `/` landing
 * page's footer link. Does not touch Supabase, cookies, or any external
 * service — if this returns 200, the Next runtime is up. Other health
 * dimensions (DB connectivity, Nango reachability) ride on their own
 * endpoints so a Supabase outage doesn't mark the frontend dead.
 *
 * `dynamic = 'force-dynamic'` tells Next never to cache this response,
 * and tells Vercel not to serve it from the edge cache. The response
 * timestamp must be current for the probe to be meaningful.
 */

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({
    ok: true,
    service: 'web',
    version: process.env.npm_package_version ?? 'dev',
    ts: new Date().toISOString(),
  });
}
