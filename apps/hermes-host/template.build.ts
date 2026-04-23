/**
 * One-off template builder — run when the image needs rebuilding.
 *
 * Usage:
 *   export E2B_API_KEY=...
 *   pnpm --filter @homehub/hermes-host template:build
 *
 * Republishes the template under the tag `homehub-hermes`. Existing
 * sandboxes keep running; the next Sandbox.create() call picks the new
 * build. Tag is versionless for simplicity — if we need rollback in the
 * future, switch to `homehub-hermes:<sha>` and pin the router env.
 */

import { Template } from 'e2b';

import { template } from './template.js';

const TAG = process.env.E2B_TEMPLATE_TAG ?? 'homehub-hermes';
const CPU = Number.parseInt(process.env.E2B_TEMPLATE_CPU ?? '1', 10);
const MEMORY_MB = Number.parseInt(process.env.E2B_TEMPLATE_MEMORY_MB ?? '2048', 10);

async function main(): Promise<void> {
  if (!process.env.E2B_API_KEY) {
    throw new Error('E2B_API_KEY is not set — grab one from https://e2b.dev/dashboard/keys');
  }
   
  console.log(`building E2B template "${TAG}" (cpu=${CPU}, memory=${MEMORY_MB}MB)...`);
  const info = await Template.build(template, TAG, {
    cpuCount: CPU,
    memoryMB: MEMORY_MB,
  });
   
  console.log('built:', info);
}

void main().catch((err) => {
   
  console.error('=== BuildError ===');
  console.error('message:', err?.message ?? '(no message)');
  console.error('name:', err?.name);
  if (err?.logs) console.error('logs:', err.logs);
  if (err?.response) console.error('response:', err.response);
  if (err?.cause) console.error('cause:', err.cause);
  console.error('full:', JSON.stringify(err, Object.getOwnPropertyNames(err ?? {}), 2));
  process.exit(1);
});
