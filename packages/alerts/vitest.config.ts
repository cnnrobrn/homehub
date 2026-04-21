/**
 * `@homehub/alerts` vitest config.
 *
 * Aliases workspace packages to their `src/index.ts` so tests resolve
 * without requiring a prior `pnpm build` of the shared package. Matches
 * the pattern in sibling packages.
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
  test: {
    include: ['src/**/*.test.ts'],
  },
});
