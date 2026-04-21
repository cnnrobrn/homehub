-- Migration: 0001_extensions.sql
-- Authored: 2026-04-20
-- Purpose: enable the five Postgres extensions HomeHub depends on.
-- Owner: @infra-platform
-- Spec: specs/02-data-model/schema.md (schemas section) and scripts/agents/infra-platform.md.
--
-- Extensions and placement (per current Supabase guidance):
--   - uuid-ossp, pg_trgm, vector (pgvector): created in the dedicated
--     `extensions` schema that Supabase pre-provisions. Supabase adds this
--     schema to the default search_path so callers can reference functions
--     unqualified.
--   - pgmq:   creates and manages its own `pgmq` schema. Do not pass
--             `with schema …` — the extension script installs into `pgmq`.
--   - pg_cron: creates the `cron` schema. It is hard-coded to live there,
--             so `with schema …` must not be passed. Requires that the
--             `cron` schema exists; the extension creates it on install.
--
-- All statements are idempotent via `if not exists` so re-running on a
-- partially-applied stack is a no-op.

create extension if not exists "uuid-ossp" with schema extensions;

create extension if not exists "pg_trgm" with schema extensions;

create extension if not exists "vector" with schema extensions;

create extension if not exists "pgmq";

create extension if not exists "pg_cron";
