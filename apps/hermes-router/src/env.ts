/**
 * Environment schema for the hermes-router service (Railway).
 *
 * The router is an always-on Railway service (no scale-to-zero → no
 * cold-start). On each chat turn it spawns a short-lived E2B
 * Firecracker microVM to run Hermes, streams stdout back as SSE, and
 * the sandbox persists household state to Supabase Storage on exit.
 *
 * No GCP. All secrets live in Railway's service env (pasted via
 * dashboard or Railway CLI); Zod validates them here.
 */

import { z } from 'zod';

export const routerEnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),

  // Supabase — router reads/writes app.household; sandboxes read/write
  // Supabase Storage with household-scoped JWTs.
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  HOMEHUB_SUPABASE_URL: z.string().url(),
  HOMEHUB_SUPABASE_ANON_KEY: z.string().min(1),
  // HS256 secret the router uses to sign household-scoped JWTs.
  // Never leaves the router process.
  HOMEHUB_SUPABASE_JWT_SECRET: z.string().min(32),
  HERMES_JWT_TTL_SECONDS: z.coerce.number().int().positive().default(600),

  // E2B — ephemeral Firecracker microVMs per chat turn.
  // Get an API key at https://e2b.dev/dashboard/keys.
  E2B_API_KEY: z.string().min(1),
  E2B_TEMPLATE: z
    .string()
    .min(1)
    .default('homehub-hermes')
    .describe('E2B template tag built from apps/hermes-host/template.ts'),
  HERMES_SANDBOX_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(120),

  // State storage — Supabase Storage. One bucket, household-scoped
  // paths enforced by RLS (see migration 0017).
  HERMES_STORAGE_BUCKET: z.string().min(1).default('hermes-state'),

  // Request auth.
  HOMEHUB_PROXY_SECRET: z.string().min(32),
  HOMEHUB_PROVISION_SECRET: z.string().min(32),

  // Injected into every sandbox.
  HERMES_SHARED_SECRET: z.string().min(32),
  HOMEHUB_OPENROUTER_API_KEY: z.string().min(1),
  HERMES_DEFAULT_MODEL: z.string().min(1).default('moonshotai/kimi-k2.6'),
});

export type RouterEnv = z.infer<typeof routerEnvSchema>;
