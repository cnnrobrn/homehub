/**
 * `mcp-homehub-core` environment schema.
 *
 * Extends the shared `workerRuntimeEnvSchema` with the two MCP-only
 * knobs:
 *   - `MCP_SERVICE_HMAC_SECRET` — shared secret for service-token
 *     validation (internal workers that call MCP tools). Optional in
 *     dev, required in production.
 *   - `MCP_DEV_TOKENS` — comma-separated `token:householdId:memberId`
 *     triples that seed the dev allowlist used when the
 *     `sync.mcp_token` table isn't available. Development-only; the
 *     middleware rejects its use when `NODE_ENV === 'production'`.
 *
 * Kept in this service rather than pushed into `@homehub/worker-runtime`
 * because no other service needs these variables.
 */

import { workerRuntimeEnvSchema } from '@homehub/worker-runtime';
import { z } from 'zod';

export const mcpCoreEnvSchema = workerRuntimeEnvSchema.extend({
  MCP_SERVICE_HMAC_SECRET: z.string().min(16).optional(),
  MCP_DEV_TOKENS: z.string().optional(),
});

export type McpCoreEnv = z.infer<typeof mcpCoreEnvSchema>;
