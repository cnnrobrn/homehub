import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Minimal Next.js config for the HomeHub web app.
 *
 * - `typedRoutes` turns on compile-time route checking so misspelled
 *   `<Link href="…" />` targets fail the build instead of 404ing in prod.
 *   (Promoted out of `experimental` in Next 15.5.)
 * - `outputFileTracingRoot` pins Next's workspace-root guess to the repo
 *   root so a stray lockfile elsewhere on the developer's machine
 *   doesn't confuse the tracer.
 * - No custom webpack / turbopack fiddling. If a real need surfaces it
 *   lands with the PR that needs it; the default pipeline is plenty.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
  // The repo's root flat config already runs ESLint across the whole
  // monorepo in CI (`pnpm lint`). `next build`'s built-in lint pass
  // tries to run its own legacy `.eslintrc` setup and fights the flat
  // config, so we disable it here — the CI coverage is equivalent.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
