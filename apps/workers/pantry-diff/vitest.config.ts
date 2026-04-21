/**
 * Vitest config for `@homehub/worker-pantry-diff`.
 *
 * Aliases workspace packages to their `src` entrypoints so tests run
 * without a prior build of dependencies.
 */

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const runtimeSrc = fileURLToPath(
  new URL('../../../packages/worker-runtime/src/index.ts', import.meta.url),
);
const sharedSrc = fileURLToPath(new URL('../../../packages/shared/src/index.ts', import.meta.url));
const dbSrc = fileURLToPath(new URL('../../../packages/db/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@homehub/worker-runtime': runtimeSrc,
      '@homehub/shared': sharedSrc,
      '@homehub/db': dbSrc,
    },
  },
});
