/**
 * Worker-service vitest config.
 *
 * Aliases workspace packages to their `src/index.ts` so tests resolve
 * without requiring a prior `pnpm build` of the runtime/shared/db
 * packages. Matches the pattern in `packages/worker-runtime/vitest.config.ts`.
 */

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const runtimeSrc = fileURLToPath(
  new URL('../../../packages/worker-runtime/src/index.ts', import.meta.url),
);
const sharedSrc = fileURLToPath(new URL('../../../packages/shared/src/index.ts', import.meta.url));
const dbSrc = fileURLToPath(new URL('../../../packages/db/src/index.ts', import.meta.url));
const providersCalendarSrc = fileURLToPath(
  new URL('../../../packages/providers/calendar/src/index.ts', import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      '@homehub/worker-runtime': runtimeSrc,
      '@homehub/shared': sharedSrc,
      '@homehub/db': dbSrc,
      '@homehub/providers-calendar': providersCalendarSrc,
    },
  },
});
