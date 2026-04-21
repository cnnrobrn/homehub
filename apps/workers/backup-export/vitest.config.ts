/**
 * `@homehub/worker-backup-export` vitest config.
 *
 * Mirrors the pattern in `apps/workers/reflector/vitest.config.ts`:
 * aliases workspace packages to their `src/index.ts` so tests resolve
 * without a prior build.
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
