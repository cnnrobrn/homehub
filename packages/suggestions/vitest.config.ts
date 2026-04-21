/**
 * Vitest config for `@homehub/suggestions`.
 *
 * Aliases shared workspace packages to their source so tests resolve
 * without a prior build step.
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
