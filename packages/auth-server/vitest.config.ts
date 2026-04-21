/**
 * Vitest config for `@homehub/auth-server`.
 *
 * Mirrors the worker-runtime vitest config: alias workspace packages to
 * their `src/index.ts` so tests run without a prior `pnpm -r build`.
 */

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const sharedSrc = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));
const dbSrc = fileURLToPath(new URL('../db/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@homehub/shared': sharedSrc,
      '@homehub/db': dbSrc,
    },
  },
});
