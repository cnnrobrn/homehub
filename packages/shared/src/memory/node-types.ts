/**
 * Memory-graph enums shared across packages.
 *
 * Every value here mirrors a `check` constraint in the `mem.*` schema
 * (migrations 0010/0011). When you add a node type, edge type, etc. you
 * ship both a migration that updates the relevant check constraint and an
 * edit to this file — the two must stay in lockstep so TypeScript callers
 * and the database agree on the enumeration.
 *
 * Re-exported from `@homehub/shared` so consumers write
 * `import { NODE_TYPES, type NodeType } from '@homehub/shared'` rather than
 * reaching into deep paths.
 */

export const NODE_TYPES = [
  'person',
  'place',
  'merchant',
  'dish',
  'ingredient',
  'topic',
  'event_type',
  'subscription',
  'account',
  'category',
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const EDGE_TYPES = [
  'attended',
  'ate',
  'contains',
  'cooked',
  'paid',
  'purchased_at',
  'located_at',
  'related_to',
  'prefers',
  'avoids',
  'recurs',
  'part_of',
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

export const EPISODE_SOURCE_TYPES = [
  'event',
  'email',
  'meal',
  'transaction',
  'conversation',
] as const;
export type EpisodeSourceType = (typeof EPISODE_SOURCE_TYPES)[number];

export const FACT_SOURCES = ['member', 'extraction', 'consolidation', 'reflection'] as const;
export type FactSource = (typeof FACT_SOURCES)[number];

export const CONFLICT_STATUSES = ['none', 'parked_conflict', 'unresolved'] as const;
export type ConflictStatus = (typeof CONFLICT_STATUSES)[number];

export const CANDIDATE_STATUSES = [
  'pending',
  'promoted',
  'rejected',
  'parked',
  'superseded',
] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];
