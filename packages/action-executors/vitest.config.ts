/**
 * Vitest config for `@homehub/action-executors`.
 *
 * Aliases workspace packages to their `src/index.ts` so tests resolve
 * without requiring a prior `pnpm build` of the runtime / db / shared
 * peers.
 */

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const sharedSrc = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));
const dbSrc = fileURLToPath(new URL('../db/src/index.ts', import.meta.url));
const runtimeSrc = fileURLToPath(new URL('../worker-runtime/src/index.ts', import.meta.url));
const approvalFlowSrc = fileURLToPath(new URL('../approval-flow/src/index.ts', import.meta.url));
const enrichmentSrc = fileURLToPath(new URL('../enrichment/src/index.ts', import.meta.url));
const calendarSrc = fileURLToPath(new URL('../providers/calendar/src/index.ts', import.meta.url));
const emailSrc = fileURLToPath(new URL('../providers/email/src/index.ts', import.meta.url));
const financialSrc = fileURLToPath(new URL('../providers/financial/src/index.ts', import.meta.url));
const grocerySrc = fileURLToPath(new URL('../providers/grocery/src/index.ts', import.meta.url));
const promptsSrc = fileURLToPath(new URL('../prompts/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@homehub/shared': sharedSrc,
      '@homehub/db': dbSrc,
      '@homehub/worker-runtime': runtimeSrc,
      '@homehub/approval-flow': approvalFlowSrc,
      '@homehub/enrichment': enrichmentSrc,
      '@homehub/prompts': promptsSrc,
      '@homehub/providers-calendar': calendarSrc,
      '@homehub/providers-email': emailSrc,
      '@homehub/providers-financial': financialSrc,
      '@homehub/providers-grocery': grocerySrc,
    },
  },
});
