-- Migration: 0005_event_transaction_account.sql
-- Authored: 2026-04-20
-- Purpose: add app.account, app.budget, app.event, app.transaction and
--          finalize the account_grant -> account FK that 0004 deferred.
-- Owner: @infra-platform
-- Spec: specs/02-data-model/schema.md.
--
-- These are the unified-calendar and financial-ledger primitives. Segments
-- are used on `event` so the unified calendar can filter/color by segment;
-- transactions inherit the `financial` segment implicitly.
--
-- `merchant_node_id` is deliberately omitted for M1 — M3 introduces the
-- mem.* schema and adds the column via alter table in that migration so
-- we do not carry a dead FK target until then.

-- --------------------------------------------------------------------------
-- app.account
-- --------------------------------------------------------------------------

create table if not exists app.account (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references app.household(id) on delete cascade,
  owner_member_id uuid references app.member(id) on delete set null,
  kind            text not null check (kind in ('checking','savings','credit','investment','loan','cash')),
  name            text not null,
  provider        text,
  external_id     text,
  balance_cents   bigint,
  currency        char(3) not null default 'USD',
  last_synced_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table app.account enable row level security;
alter table app.account force row level security;

create index if not exists account_household_idx on app.account (household_id);
create index if not exists account_owner_idx     on app.account (owner_member_id);
create unique index if not exists account_provider_external_unique
  on app.account (provider, external_id)
  where provider is not null and external_id is not null;

-- Close out the deferred account_grant write policy from 0004 — requires
-- app.account to exist. Drop-then-create keeps the migration idempotent.
drop policy if exists account_grant_write on app.account_grant;
create policy account_grant_write on app.account_grant
  for all
  using (
    exists (
      select 1
      from app.account a
      join app.member m on m.household_id = a.household_id
      where a.id = app.account_grant.account_id
        and m.user_id = app.current_user_id()
        and m.role = 'owner'
    )
  )
  with check (
    exists (
      select 1
      from app.account a
      join app.member m on m.household_id = a.household_id
      where a.id = app.account_grant.account_id
        and m.user_id = app.current_user_id()
        and m.role = 'owner'
    )
  );

-- Close out the deferred FK from 0004. We do it with a guarded DO block so
-- re-runs are no-ops (alter table add constraint has no `if not exists`
-- until PG17.x and we can't rely on it everywhere).
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conname = 'account_grant_account_id_fkey'
      and c.conrelid = 'app.account_grant'::regclass
  ) then
    alter table app.account_grant
      add constraint account_grant_account_id_fkey
      foreign key (account_id) references app.account(id) on delete cascade;
  end if;
end
$$;

-- --------------------------------------------------------------------------
-- app.budget
-- --------------------------------------------------------------------------

create table if not exists app.budget (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references app.household(id) on delete cascade,
  name          text not null,
  period        text not null check (period in ('weekly','monthly','yearly')),
  category      text not null,
  amount_cents  bigint not null,
  currency      char(3) not null default 'USD',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table app.budget enable row level security;
alter table app.budget force row level security;

create index if not exists budget_household_idx on app.budget (household_id);
create index if not exists budget_household_category_idx on app.budget (household_id, category);

-- --------------------------------------------------------------------------
-- app.event
-- --------------------------------------------------------------------------

create table if not exists app.event (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references app.household(id) on delete cascade,
  owner_member_id  uuid references app.member(id) on delete set null,
  segment          text not null check (segment in ('financial','food','fun','social','system')),
  kind             text not null,
  title            text not null,
  starts_at        timestamptz not null,
  ends_at          timestamptz,
  all_day          boolean not null default false,
  location         text,
  source_id        text,
  source_version   text,
  provider         text,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table app.event enable row level security;
alter table app.event force row level security;

-- Idempotent upserts from providers use (provider, source_id) as the key.
create unique index if not exists event_provider_source_unique
  on app.event (household_id, provider, source_id)
  where provider is not null and source_id is not null;

-- Hot path: the unified calendar reads `where household_id = $1 and
-- starts_at between ...`.
create index if not exists event_household_starts_idx
  on app.event (household_id, starts_at);

-- Segment filter on top of the calendar.
create index if not exists event_household_segment_starts_idx
  on app.event (household_id, segment, starts_at);

-- --------------------------------------------------------------------------
-- app.transaction
--
-- `merchant_node_id` is added in M3 when mem.node arrives.
-- --------------------------------------------------------------------------

create table if not exists app.transaction (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references app.household(id) on delete cascade,
  member_id       uuid references app.member(id) on delete set null,
  occurred_at     timestamptz not null,
  amount_cents    bigint not null,
  currency        char(3) not null default 'USD',
  merchant_raw    text,
  category        text,
  account_id      uuid references app.account(id) on delete set null,
  source          text not null check (source in ('monarch','ynab','plaid','email_receipt','manual')),
  source_id       text,
  source_version  text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table app.transaction enable row level security;
alter table app.transaction force row level security;

create unique index if not exists transaction_source_unique
  on app.transaction (source, source_id)
  where source_id is not null;

create index if not exists transaction_household_occurred_idx
  on app.transaction (household_id, occurred_at desc);

create index if not exists transaction_account_occurred_idx
  on app.transaction (account_id, occurred_at desc)
  where account_id is not null;

create index if not exists transaction_household_member_occurred_idx
  on app.transaction (household_id, member_id, occurred_at desc);

-- --------------------------------------------------------------------------
-- RLS policies
-- --------------------------------------------------------------------------

-- --- account ---------------------------------------------------------------
drop policy if exists account_read on app.account;
create policy account_read on app.account
  for select
  using (app.can_read_account(id));

drop policy if exists account_write on app.account;
create policy account_write on app.account
  for all
  using (
    -- Per-account write grant OR (Financial write AND no explicit deny).
    app.can_write_account(id)
    -- Plus the household-owner path: owners can always create new accounts
    -- in their household (the helper requires the account row to exist,
    -- which it doesn't during INSERT WITH CHECK evaluation).
    or exists (
      select 1 from app.member m
      where m.household_id = app.account.household_id
        and m.user_id = app.current_user_id()
        and m.role = 'owner'
    )
  )
  with check (
    app.can_write_account(id)
    or exists (
      select 1 from app.member m
      where m.household_id = app.account.household_id
        and m.user_id = app.current_user_id()
        and m.role = 'owner'
    )
  );

-- --- budget ---------------------------------------------------------------
drop policy if exists budget_read on app.budget;
create policy budget_read on app.budget
  for select
  using (app.can_read_segment(household_id, 'financial'));

drop policy if exists budget_write on app.budget;
create policy budget_write on app.budget
  for all
  using (app.can_write_segment(household_id, 'financial'))
  with check (app.can_write_segment(household_id, 'financial'));

-- --- event ----------------------------------------------------------------
drop policy if exists event_read on app.event;
create policy event_read on app.event
  for select
  using (app.can_read_segment(household_id, segment));

drop policy if exists event_write on app.event;
create policy event_write on app.event
  for all
  using (app.can_write_segment(household_id, segment))
  with check (app.can_write_segment(household_id, segment));

-- --- transaction ----------------------------------------------------------
drop policy if exists transaction_read on app.transaction;
-- If the transaction is attached to an account, account-grant wins;
-- otherwise fall back to Financial segment access.
create policy transaction_read on app.transaction
  for select
  using (
    case
      when account_id is not null then app.can_read_account(account_id)
      else app.can_read_segment(household_id, 'financial')
    end
  );

drop policy if exists transaction_write on app.transaction;
create policy transaction_write on app.transaction
  for all
  using (
    case
      when account_id is not null then app.can_write_account(account_id)
      else app.can_write_segment(household_id, 'financial')
    end
  )
  with check (
    case
      when account_id is not null then app.can_write_account(account_id)
      else app.can_write_segment(household_id, 'financial')
    end
  );
