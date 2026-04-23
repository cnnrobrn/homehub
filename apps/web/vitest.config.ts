/**
 * Vitest config for `@homehub/web`.
 *
 * Two environments share this file:
 *   - Server actions and pure helpers run under `node` (the default).
 *   - Component tests run under `jsdom`; we opt-in per-file by placing
 *     tests under `src/components/` and letting the `environmentMatchGlobs`
 *     pattern flip the environment.
 *
 * Aliases mirror the web app's `@/*` path map plus workspace packages
 * resolved to source so the test runner does not need a prior build.
 */

import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const srcRoot = fileURLToPath(new URL('./src', import.meta.url));
const sharedSrc = fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url));
const dbSrc = fileURLToPath(new URL('../../packages/db/src/index.ts', import.meta.url));
const authServerSrc = fileURLToPath(
  new URL('../../packages/auth-server/src/index.ts', import.meta.url),
);
const approvalFlowSrc = fileURLToPath(
  new URL('../../packages/approval-flow/src/index.ts', import.meta.url),
);
const queryMemorySrc = fileURLToPath(
  new URL('../../packages/query-memory/src/index.ts', import.meta.url),
);
const toolsSrc = fileURLToPath(new URL('../../packages/tools/src/index.ts', import.meta.url));
const foregroundAgentSrc = fileURLToPath(
  new URL('../workers/foreground-agent/src/handler.ts', import.meta.url),
);
const workerRuntimeSrc = fileURLToPath(
  new URL('../../packages/worker-runtime/src/index.ts', import.meta.url),
);
const providersEmailSrc = fileURLToPath(
  new URL('../../packages/providers/email/src/index.ts', import.meta.url),
);
const providersEmailClientSrc = fileURLToPath(
  new URL('../../packages/providers/email/src/client.ts', import.meta.url),
);
const providersGrocerySrc = fileURLToPath(
  new URL('../../packages/providers/grocery/src/index.ts', import.meta.url),
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': srcRoot,
      '@homehub/shared': sharedSrc,
      '@homehub/db': dbSrc,
      '@homehub/auth-server': authServerSrc,
      '@homehub/approval-flow': approvalFlowSrc,
      '@homehub/query-memory': queryMemorySrc,
      '@homehub/tools': toolsSrc,
      '@homehub/worker-foreground-agent': foregroundAgentSrc,
      '@homehub/worker-runtime': workerRuntimeSrc,
      // More specific subpath aliases must come first — Vite matches in
      // declaration order, so listing the bare package name before `/client`
      // would rewrite the subpath import to `.../src/index.ts/client`.
      '@homehub/providers-email/client': providersEmailClientSrc,
      '@homehub/providers-email': providersEmailSrc,
      '@homehub/providers-grocery': providersGrocerySrc,
    },
  },
  test: {
    globals: false,
    // Default to Node. Component tests that need a DOM set their
    // environment via the `@vitest-environment jsdom` doc-comment pragma
    // at the top of the file (vitest 4 deprecated `environmentMatchGlobs`).
    environment: 'node',
    setupFiles: ['./test-setup.ts'],
    css: false,
    server: {
      deps: {
        inline: [/@testing-library\//, /@radix-ui\//],
      },
    },
  },
});
