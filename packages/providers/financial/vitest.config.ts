/**
 * Vitest config for `@homehub/providers-financial`.
 *
 * Aliases the worker-runtime workspace package to its `src/index.ts` so
 * tests resolve without a prior build of the runtime.
 */

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const runtimeSrc = fileURLToPath(new URL('../../worker-runtime/src/index.ts', import.meta.url));
const oauthGoogleSrc = fileURLToPath(new URL('../../oauth-google/src/index.ts', import.meta.url));
const sharedSrc = fileURLToPath(new URL('../../shared/src/index.ts', import.meta.url));
const dbSrc = fileURLToPath(new URL('../../db/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@homehub/worker-runtime': runtimeSrc,
      '@homehub/oauth-google': oauthGoogleSrc,
      '@homehub/shared': sharedSrc,
      '@homehub/db': dbSrc,
    },
  },
});
