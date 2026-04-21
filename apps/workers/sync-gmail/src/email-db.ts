/**
 * Hand-written type shims for the `app.email` + `app.email_attachment`
 * tables.
 *
 * Until migration `0012_email_ingestion.sql` lands and
 * `pnpm --filter @homehub/db db:types` regenerates the canonical types,
 * `@homehub/db`'s `Database` export does not know about these two
 * tables. We declare the Insert shapes we need here so the sync-gmail
 * handler can typecheck against the future schema. When the migration
 * lands, swap imports from this file to `@homehub/db` and delete this
 * shim.
 *
 * Shape matches the SQL migration request documented in the M4-A
 * dispatch report (see `scripts/agents/integrations.md` cross-reference).
 */

import type { Json } from '@homehub/db';

/** Corresponds to `app.email` (migration 0012). */
export interface EmailInsert {
  household_id: string;
  member_id?: string | null;
  connection_id?: string | null;
  provider?: string;
  source_id: string;
  source_version?: string | null;
  thread_id?: string | null;
  subject?: string | null;
  from_email?: string | null;
  from_name?: string | null;
  to_emails?: string[];
  received_at: string;
  categories?: string[];
  body_preview?: string | null;
  has_attachments?: boolean;
  labels?: string[];
  metadata?: Json;
  segment?: string;
  updated_at?: string;
}

/** Corresponds to `app.email_attachment` (migration 0012). */
export interface EmailAttachmentInsert {
  household_id: string;
  email_id: string;
  filename: string;
  content_type?: string | null;
  size_bytes?: number | null;
  storage_path: string;
  content_hash?: string | null;
}

/** Canonical provider value we stamp on `app.email.provider`. */
export const EMAIL_PROVIDER = 'gmail';

/** Supabase Storage bucket for attachments. Provisioned in migration 0012. */
export const EMAIL_ATTACHMENTS_BUCKET = 'email_attachments';
