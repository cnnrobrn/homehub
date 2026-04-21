/**
 * `getPersonDetail` — loads a person node plus recent episodes,
 * upcoming social events, and pending social suggestions referencing
 * the person. Returns `null` when the node is missing or not a
 * `type='person'` node.
 *
 * Deep-links to `/memory/person/[nodeId]` for the full graph browser
 * view; this helper surfaces the social-specific shape used by the
 * `/social/people/[personId]` page.
 */

import { type Database } from '@homehub/db';
import { z } from 'zod';

import {
  hasSocialRead,
  type PersonRow,
  type SegmentGrant,
  type SocialSuggestionRow,
} from './types';

import { createClient, type ServerSupabaseClient } from '@/lib/supabase/server';

export const getPersonDetailArgsSchema = z.object({
  householdId: z.string().uuid(),
  personNodeId: z.string().uuid(),
});

export type GetPersonDetailArgs = z.infer<typeof getPersonDetailArgsSchema>;

type NodeRowDb = Database['mem']['Tables']['node']['Row'];
type FactRowDb = Database['mem']['Tables']['fact']['Row'];
type EpisodeRowDb = Database['mem']['Tables']['episode']['Row'];
type EventRowDb = Database['app']['Tables']['event']['Row'];
type SuggestionRowDb = Database['app']['Tables']['suggestion']['Row'];

export interface PersonEpisode {
  id: string;
  title: string;
  summary: string | null;
  occurredAt: string;
  placeNodeId: string | null;
  sourceType: string;
}

export interface PersonUpcomingEvent {
  id: string;
  kind: string;
  title: string;
  startsAt: string;
  metadata: Record<string, unknown>;
}

export interface PersonFact {
  id: string;
  predicate: string;
  objectValue: unknown;
  objectNodeId: string | null;
  confidence: number;
  recordedAt: string;
}

export interface PersonDetail {
  person: PersonRow;
  documentMd: string | null;
  manualNotesMd: string | null;
  facts: PersonFact[];
  episodes: PersonEpisode[];
  upcomingEvents: PersonUpcomingEvent[];
  suggestions: SocialSuggestionRow[];
  reciprocity: {
    weHosted: number;
    hostedUs: number;
    totalEpisodes: number;
  };
}

export interface GetPersonDetailDeps {
  client?: ServerSupabaseClient;
  grants?: readonly SegmentGrant[];
}

export async function getPersonDetail(
  args: GetPersonDetailArgs,
  deps: GetPersonDetailDeps = {},
): Promise<PersonDetail | null> {
  const parsed = getPersonDetailArgsSchema.parse(args);
  if (deps.grants && !hasSocialRead(deps.grants)) return null;

  const client = deps.client ?? (await createClient());
  const { data: nodeRow, error: nodeErr } = await client
    .schema('mem')
    .from('node')
    .select('*')
    .eq('id', parsed.personNodeId)
    .eq('household_id', parsed.householdId)
    .eq('type', 'person')
    .maybeSingle();
  if (nodeErr) throw new Error(`getPersonDetail: ${nodeErr.message}`);
  if (!nodeRow) return null;
  const node = nodeRow as NodeRowDb;

  const [factRes, episodeRes, eventRes, suggRes, homePlaceRes] = await Promise.all([
    client
      .schema('mem')
      .from('fact')
      .select(
        'id, predicate, object_value, object_node_id, confidence, recorded_at, valid_to, superseded_at',
      )
      .eq('household_id', parsed.householdId)
      .eq('subject_node_id', parsed.personNodeId),
    client
      .schema('mem')
      .from('episode')
      .select('id, title, summary, occurred_at, place_node_id, source_type, participants')
      .eq('household_id', parsed.householdId)
      .overlaps('participants', [parsed.personNodeId])
      .order('occurred_at', { ascending: false })
      .limit(25),
    client
      .schema('app')
      .from('event')
      .select('id, kind, title, starts_at, metadata')
      .eq('household_id', parsed.householdId)
      .eq('segment', 'social')
      .gte('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: true })
      .limit(20),
    client
      .schema('app')
      .from('suggestion')
      .select('id, household_id, kind, title, rationale, status, created_at, preview')
      .eq('household_id', parsed.householdId)
      .eq('segment', 'social')
      .eq('status', 'pending')
      .limit(50),
    client
      .schema('mem')
      .from('node')
      .select('id, metadata')
      .eq('household_id', parsed.householdId)
      .eq('type', 'place'),
  ]);

  const facts: PersonFact[] = ((factRes.data ?? []) as FactRowDb[])
    .filter((f) => f.valid_to === null && f.superseded_at === null)
    .map((f) => ({
      id: f.id,
      predicate: f.predicate,
      objectValue: f.object_value,
      objectNodeId: f.object_node_id,
      confidence: f.confidence,
      recordedAt: f.recorded_at,
    }));

  const episodes: PersonEpisode[] = ((episodeRes.data ?? []) as EpisodeRowDb[]).map((e) => ({
    id: e.id,
    title: e.title,
    summary: e.summary,
    occurredAt: e.occurred_at,
    placeNodeId: e.place_node_id,
    sourceType: e.source_type,
  }));

  // Filter upcoming events to those that reference this person.
  const upcomingEvents: PersonUpcomingEvent[] = ((eventRes.data ?? []) as EventRowDb[])
    .filter((e) => {
      const meta = (e.metadata as Record<string, unknown> | null) ?? {};
      return (
        meta['subject_node_id'] === parsed.personNodeId ||
        meta['related_person_node_id'] === parsed.personNodeId
      );
    })
    .map((e) => ({
      id: e.id,
      kind: e.kind,
      title: e.title,
      startsAt: e.starts_at,
      metadata: (e.metadata as Record<string, unknown> | null) ?? {},
    }));

  const suggestions: SocialSuggestionRow[] = ((suggRes.data ?? []) as SuggestionRowDb[])
    .filter((s) => {
      const preview = (s.preview as Record<string, unknown> | null) ?? {};
      return preview['person_node_id'] === parsed.personNodeId;
    })
    .map((s) => ({
      id: s.id,
      householdId: s.household_id,
      kind: s.kind,
      title: s.title,
      rationale: s.rationale,
      status: s.status,
      createdAt: s.created_at,
      preview: (s.preview as Record<string, unknown> | null) ?? {},
    }));

  // Reciprocity: count episodes where place_node_id is (or isn't) in
  // the home-place set. Mirrors the detector logic.
  const homePlaces = new Set<string>();
  for (const row of (homePlaceRes.data ?? []) as Array<{ id: string; metadata: unknown }>) {
    const meta = (row.metadata as Record<string, unknown> | null) ?? {};
    if (meta['is_home'] === true) homePlaces.add(row.id);
  }
  let weHosted = 0;
  let hostedUs = 0;
  let totalEpisodes = 0;
  for (const e of (episodeRes.data ?? []) as EpisodeRowDb[]) {
    if (!e.place_node_id) continue;
    totalEpisodes += 1;
    if (homePlaces.has(e.place_node_id)) weHosted += 1;
    else hostedUs += 1;
  }

  const metadata =
    node.metadata !== null && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
      ? (node.metadata as Record<string, unknown>)
      : {};

  return {
    person: {
      id: node.id,
      householdId: node.household_id,
      canonicalName: node.canonical_name,
      needsReview: Boolean(node.needs_review),
      createdAt: node.created_at,
      updatedAt: node.updated_at,
      aliases: [],
      metadata,
      relationship:
        typeof metadata['relationship'] === 'string' ? (metadata['relationship'] as string) : null,
    },
    documentMd: node.document_md,
    manualNotesMd: node.manual_notes_md,
    facts,
    episodes,
    upcomingEvents,
    suggestions,
    reciprocity: { weHosted, hostedUs, totalEpisodes },
  };
}
