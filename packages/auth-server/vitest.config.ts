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
const approvalFlowSrc = fileURLToPath(new URL('../approval-flow/src/index.ts', import.meta.url));
const runtimeSrc = fileURLToPath(new URL('../worker-runtime/src/index.ts', import.meta.url));
const oauthGoogleSrc = fileURLToPath(new URL('../oauth-google/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@homehub/shared': sharedSrc,
      '@homehub/db': dbSrc,
      '@homehub/approval-flow': approvalFlowSrc,
      '@homehub/worker-runtime': runtimeSrc,
      '@homehub/oauth-google': oauthGoogleSrc,
    },
  },
});
