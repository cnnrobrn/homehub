/**
 * `@homehub/enrichment` vitest config.
 *
 * Aliases workspace packages to their `src/index.ts` so tests run
 * without requiring a prior `pnpm build` of the shared / prompts /
 * db / worker-runtime packages.
 */

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const sharedSrc = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));
const promptsSrc = fileURLToPath(new URL('../prompts/src/index.ts', import.meta.url));
const dbSrc = fileURLToPath(new URL('../db/src/index.ts', import.meta.url));
const runtimeSrc = fileURLToPath(new URL('../worker-runtime/src/index.ts', import.meta.url));
const oauthGoogleSrc = fileURLToPath(new URL('../oauth-google/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@homehub/shared': sharedSrc,
      '@homehub/prompts': promptsSrc,
      '@homehub/db': dbSrc,
      '@homehub/worker-runtime': runtimeSrc,
      '@homehub/oauth-google': oauthGoogleSrc,
    },
  },
});
