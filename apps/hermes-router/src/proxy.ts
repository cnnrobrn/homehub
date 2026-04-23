/**
 * Superseded by `sandbox.ts` after the Cloud Run Sandboxes pivot.
 *
 * The router no longer opens an SSE stream to a long-lived
 * per-household service. It spawns a sandbox per turn and streams
 * the sandbox's stdout directly back to apps/web. See `sandbox.ts`.
 */

export {};
