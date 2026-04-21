import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
  // Static HTML export — the marketing site has no server features, so
  // we dump prerendered HTML to `out/` and serve it via Cloudflare
  // Workers Static Assets. `trailingSlash` keeps URLs like
  // `/features/` resolving without a server-side redirect.
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
