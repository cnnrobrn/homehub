/**
 * Vitest config for `@homehub/tools`.
 *
 * Workspace packages are aliased to their source so tests don't
 * require a prior `pnpm build` of the dependency graph.
 */

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const dbSrc = fileURLToPath(new URL('../db/src/index.ts', import.meta.url));
const sharedSrc = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));
const queryMemorySrc = fileURLToPath(new URL('../query-memory/src/index.ts', import.meta.url));
const workerRuntimeSrc = fileURLToPath(new URL('../worker-runtime/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@homehub/db': dbSrc,
      '@homehub/shared': sharedSrc,
      '@homehub/query-memory': queryMemorySrc,
      '@homehub/worker-runtime': workerRuntimeSrc,
    },
  },
  test: {
    environment: 'node',
  },
});
