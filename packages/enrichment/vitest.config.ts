/**
 * `@homehub/enrichment` vitest config.
 *
 * Aliases workspace packages to their `src/index.ts` so tests can run
 * without a prior `pnpm build` of `@homehub/shared`. Matches the pattern
 * used across every other HomeHub package's vitest config.
 */

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const sharedSrc = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@homehub/shared': sharedSrc,
    },
  },
});
