/**
 * Vitest config for `@homehub/approval-flow`.
 *
 * Aliases workspace packages to their `src/index.ts` so tests resolve
 * without requiring a prior `pnpm build` of shared / db / worker-runtime.
 */

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const sharedSrc = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));
const dbSrc = fileURLToPath(new URL('../db/src/index.ts', import.meta.url));
const runtimeSrc = fileURLToPath(new URL('../worker-runtime/src/index.ts', import.meta.url));
const oauthGoogleSrc = fileURLToPath(new URL('../oauth-google/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@homehub/shared': sharedSrc,
      '@homehub/db': dbSrc,
      '@homehub/worker-runtime': runtimeSrc,
      '@homehub/oauth-google': oauthGoogleSrc,
    },
  },
});
