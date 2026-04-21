/**
 * `backup-export` handler — build a portable export of a household's
 * data and drop it into Supabase Storage under the `household_exports`
 * bucket.
 *
 * What's in the bundle (per the M10 dispatch):
 *   - household.json                — household + members + grants
 *   - events.ndjson                 — app.event
 *   - transactions.ndjson           — app.transaction
 *   - meals.ndjson                  — app.meal (when the table exists)
 *   - pantry.ndjson                 — app.pantry_item (when the table exists)
 *   - memory/nodes.ndjson
 *   - memory/facts.ndjson
 *   - memory/episodes.ndjson
 *   - memory/edges.ndjson
 *   - manifest.json                 — timestamp + schema version + row counts
 *
 * `attachments/` is documented but deferred to the real export worker
 * implementation; copying Supabase Storage objects across buckets needs
 * a follow-up PR with the right ACL wiring (tracked under M11).
 *
 * Idempotent: serialization is deterministic (see `./serialize.ts`), so
 * two runs over identical data produce byte-identical output.
 *
 * The export is **scaffolded** in M10: the serialization + storage
 * upload land now, but the worker is wired to a queue that the pending
 * migration 0014 provisions (`household_export`). Until the migration
 * applies, `runHouseholdExport()` still works end-to-end when given the
 * household id directly.
 */

import { type Logger, type ServiceSupabaseClient } from '@homehub/worker-runtime';

import { makeManifest, toNdjson } from './serialize.js';

export const EXPORT_SCHEMA_VERSION = 1;
export const EXPORT_BUCKET = 'household_exports';

export interface RunExportArgs {
  supabase: ServiceSupabaseClient;
  log: Logger;
  householdId: string;
  /** Override for tests; defaults to `new Date()`. */
  now?: Date;
}

export interface RunExportResult {
  storagePath: string;
  sizeBytes: number;
  rowCounts: Record<string, number>;
  manifest: string;
  files: Record<string, string>;
}

/**
 * Read a table, skipping gracefully if the relation doesn't exist in
 * this environment. We scope every read by `household_id` to keep the
 * export tight and to stay on the owner-approved surface.
 */
async function readTable(
  supabase: ServiceSupabaseClient,
  schema: string,
  table: string,
  householdId: string,
  log: Logger,
): Promise<Record<string, unknown>[] | null> {
  try {
    const client = supabase as unknown as {
      schema: (s: string) => {
        from: (t: string) => {
          select: (c: string) => {
            eq: (
              col: string,
              val: string,
            ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
          };
        };
      };
    };
    const { data, error } = await client
      .schema(schema)
      .from(table)
      .select('*')
      .eq('household_id', householdId);
    if (error) {
      log.debug('export: table read failed', {
        table: `${schema}.${table}`,
        error: error.message,
      });
      return null;
    }
    return (data ?? []) as Record<string, unknown>[];
  } catch (err) {
    log.debug('export: table read threw', {
      table: `${schema}.${table}`,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function readHouseholdJson(
  supabase: ServiceSupabaseClient,
  householdId: string,
): Promise<string> {
  const { data: hh, error: hhErr } = await supabase
    .schema('app')
    .from('household')
    .select('id, name, settings, created_at')
    .eq('id', householdId)
    .maybeSingle();
  if (hhErr) {
    throw new Error(`household read failed: ${hhErr.message}`);
  }

  const { data: members, error: mErr } = await supabase
    .schema('app')
    .from('member')
    .select('id, user_id, role, joined_at, household_id')
    .eq('household_id', householdId);
  if (mErr) {
    throw new Error(`member read failed: ${mErr.message}`);
  }
  const memberIds = (members ?? []).map((m) => m.id as string);

  let grants: Record<string, unknown>[] = [];
  if (memberIds.length > 0) {
    const { data: g, error: gErr } = await supabase
      .schema('app')
      .from('member_segment_grant')
      .select('member_id, segment, access')
      .in('member_id', memberIds);
    if (gErr) {
      throw new Error(`grants read failed: ${gErr.message}`);
    }
    grants = (g ?? []) as Record<string, unknown>[];
  }

  return toNdjson([
    {
      id: householdId,
      household: hh,
      members: (members ?? []).sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? ''))),
      grants: grants.sort(
        (a, b) =>
          String(a.member_id ?? '').localeCompare(String(b.member_id ?? '')) ||
          String(a.segment ?? '').localeCompare(String(b.segment ?? '')),
      ),
    },
  ]);
}

/**
 * Runs the export. Returns the assembled files + manifest; the caller
 * uploads them (tests exercise this without needing Supabase Storage).
 */
export async function runHouseholdExport(args: RunExportArgs): Promise<RunExportResult> {
  const now = args.now ?? new Date();
  const timestamp = now.toISOString();

  const householdJson = await readHouseholdJson(args.supabase, args.householdId);

  // Tables whose rows we persist. Tables that don't exist in this
  // environment are omitted from the manifest (readTable returns null).
  const tableMap: Array<{ path: string; schema: string; table: string }> = [
    { path: 'events.ndjson', schema: 'app', table: 'event' },
    { path: 'transactions.ndjson', schema: 'app', table: 'transaction' },
    { path: 'meals.ndjson', schema: 'app', table: 'meal' },
    { path: 'pantry.ndjson', schema: 'app', table: 'pantry_item' },
    { path: 'memory/nodes.ndjson', schema: 'mem', table: 'node' },
    { path: 'memory/facts.ndjson', schema: 'mem', table: 'fact' },
    { path: 'memory/episodes.ndjson', schema: 'mem', table: 'episode' },
    { path: 'memory/edges.ndjson', schema: 'mem', table: 'edge' },
  ];

  const files: Record<string, string> = {
    'household.json': householdJson,
  };
  const rowCounts: Record<string, number> = {};

  for (const t of tableMap) {
    const rows = await readTable(args.supabase, t.schema, t.table, args.householdId, args.log);
    if (rows === null) continue;
    files[t.path] = toNdjson(rows);
    rowCounts[`${t.schema}.${t.table}`] = rows.length;
  }

  const manifest = makeManifest({
    householdId: args.householdId,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: timestamp,
    rowCounts,
  });
  files['manifest.json'] = manifest;

  const sizeBytes = Object.values(files).reduce((acc, s) => acc + Buffer.byteLength(s, 'utf8'), 0);
  const storagePath = `${args.householdId}/${timestamp.replace(/[:.]/g, '-')}/`;

  return { storagePath, sizeBytes, rowCounts, manifest, files };
}
