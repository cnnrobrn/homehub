-- Migration: 0008_conversation.sql
-- Authored: 2026-04-20
-- Purpose: add app.conversation, app.conversation_turn, and
--          app.conversation_attachment tables that M3.5 will use for the
--          first-party chat feature.
-- Owner: @infra-platform
-- Spec: specs/13-conversation/conversations-data-model.md.
--
-- M1 ships these as stubs-with-real-shape so the frontend-chat specialist
-- can start wiring the UI against real types. The streaming-persistence
-- behavior described in the spec is application-level (incremental upserts
-- on body_md); the schema supports it but does not enforce it.

create table if not exists app.conversation (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references app.household(id) on delete cascade,
  title            text,
  created_by       uuid references app.member(id) on delete set null,
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz not null default now(),
  pinned           boolean not null default false,
  archived_at      timestamptz
);

alter table app.conversation enable row level security;
alter table app.conversation force row level security;

create index if not exists conversation_household_last_idx
  on app.conversation (household_id, last_message_at desc);

create index if not exists conversation_household_pinned_idx
  on app.conversation (household_id, pinned)
  where pinned = true;

-- --------------------------------------------------------------------------
-- app.conversation_turn
-- --------------------------------------------------------------------------

create table if not exists app.conversation_turn (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references app.conversation(id) on delete cascade,
  -- Denormalized household_id lets RLS avoid a join on every row.
  household_id      uuid not null references app.household(id) on delete cascade,
  author_member_id  uuid references app.member(id) on delete set null,
  role              text not null check (role in ('member','assistant','tool','system')),
  body_md           text not null default '',
  tool_calls        jsonb,
  citations         jsonb,
  created_at        timestamptz not null default now(),
  model             text,
  input_tokens      integer,
  output_tokens     integer,
  cost_cents        real,
  no_memory_write   boolean not null default false
);

alter table app.conversation_turn enable row level security;
alter table app.conversation_turn force row level security;

create index if not exists conversation_turn_conversation_created_idx
  on app.conversation_turn (conversation_id, created_at);

create index if not exists conversation_turn_household_idx
  on app.conversation_turn (household_id);

-- --------------------------------------------------------------------------
-- app.conversation_attachment
-- --------------------------------------------------------------------------

create table if not exists app.conversation_attachment (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references app.conversation(id) on delete cascade,
  turn_id          uuid references app.conversation_turn(id) on delete set null,
  -- Denormalized household_id for RLS.
  household_id     uuid not null references app.household(id) on delete cascade,
  storage_path     text not null,
  mime_type        text not null,
  processed_as     text,
  created_at       timestamptz not null default now()
);

alter table app.conversation_attachment enable row level security;
alter table app.conversation_attachment force row level security;

create index if not exists conversation_attachment_conversation_idx
  on app.conversation_attachment (conversation_id);

create index if not exists conversation_attachment_household_idx
  on app.conversation_attachment (household_id);

-- --------------------------------------------------------------------------
-- RLS policies
-- --------------------------------------------------------------------------

-- Conversation: read by any household member (spec: "all household-visible
-- in v1"). Write by the authoring member only.
drop policy if exists conversation_read on app.conversation;
create policy conversation_read on app.conversation
  for select
  using (app.is_member(household_id));

drop policy if exists conversation_insert on app.conversation;
create policy conversation_insert on app.conversation
  for insert
  with check (
    app.is_member(household_id)
    and created_by = app.member_id(household_id)
  );

drop policy if exists conversation_update on app.conversation;
create policy conversation_update on app.conversation
  for update
  using (
    app.is_member(household_id)
    and created_by = app.member_id(household_id)
  )
  with check (
    app.is_member(household_id)
    and created_by = app.member_id(household_id)
  );

drop policy if exists conversation_delete on app.conversation;
create policy conversation_delete on app.conversation
  for delete
  using (
    app.is_member(household_id)
    and created_by = app.member_id(household_id)
  );

-- Conversation turn: same read, same author-only write.
drop policy if exists conversation_turn_read on app.conversation_turn;
create policy conversation_turn_read on app.conversation_turn
  for select
  using (app.is_member(household_id));

drop policy if exists conversation_turn_insert on app.conversation_turn;
create policy conversation_turn_insert on app.conversation_turn
  for insert
  with check (
    app.is_member(household_id)
    -- Member turns must be authored by the caller; assistant/tool/system
    -- turns are service-role only (they bypass RLS).
    and role = 'member'
    and author_member_id = app.member_id(household_id)
  );

drop policy if exists conversation_turn_update on app.conversation_turn;
create policy conversation_turn_update on app.conversation_turn
  for update
  using (
    app.is_member(household_id)
    and role = 'member'
    and author_member_id = app.member_id(household_id)
  )
  with check (
    app.is_member(household_id)
    and role = 'member'
    and author_member_id = app.member_id(household_id)
  );

drop policy if exists conversation_turn_delete on app.conversation_turn;
create policy conversation_turn_delete on app.conversation_turn
  for delete
  using (
    app.is_member(household_id)
    and role = 'member'
    and author_member_id = app.member_id(household_id)
  );

-- Attachment: readable by any household member; writable by the conversation's
-- author (follow-through on "author writes the conversation it belongs to").
drop policy if exists conversation_attachment_read on app.conversation_attachment;
create policy conversation_attachment_read on app.conversation_attachment
  for select
  using (app.is_member(household_id));

drop policy if exists conversation_attachment_write on app.conversation_attachment;
create policy conversation_attachment_write on app.conversation_attachment
  for all
  using (
    exists (
      select 1 from app.conversation c
      where c.id = app.conversation_attachment.conversation_id
        and c.created_by = app.member_id(c.household_id)
    )
  )
  with check (
    exists (
      select 1 from app.conversation c
      where c.id = app.conversation_attachment.conversation_id
        and c.created_by = app.member_id(c.household_id)
    )
  );
