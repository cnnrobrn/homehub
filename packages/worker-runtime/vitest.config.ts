/**
 * Vitest config for `@homehub/worker-runtime`.
 *
 * We alias workspace packages to their `src/index.ts` so tests don't
 * require a prior `pnpm -r build`. Production consumers keep using the
 * compiled `dist/` output via `package.json#exports`; only the test
 * runner reaches into source.
 */

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const sharedSrc = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));
const dbSrc = fileURLToPath(new URL('../db/src/index.ts', import.meta.url));
const oauthGoogleSrc = fileURLToPath(new URL('../oauth-google/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@homehub/shared': sharedSrc,
      '@homehub/db': dbSrc,
      '@homehub/oauth-google': oauthGoogleSrc,
    },
  },
});
