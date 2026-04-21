-- Migration: 0006_food.sql
-- Authored: 2026-04-20
-- Purpose: add app.meal, app.pantry_item, app.grocery_list, app.grocery_list_item
--          for the Food segment MVP.
-- Owner: @infra-platform
-- Spec: specs/02-data-model/schema.md (Food tables).
--
-- Segment on these is always 'food' so every policy funnels through the
-- can_read_segment / can_write_segment helpers with the segment baked in.
-- `dish_node_id` references mem.node which does not exist yet; like
-- `merchant_node_id` on transaction, we defer the FK until M3.

-- --------------------------------------------------------------------------
-- app.meal
-- --------------------------------------------------------------------------

create table if not exists app.meal (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references app.household(id) on delete cascade,
  planned_for     date not null,
  slot            text not null check (slot in ('breakfast','lunch','dinner','snack')),
  -- dish_node_id uuid references mem.node(id) — added in M3.
  dish_node_id    uuid,
  title           text not null,
  servings        integer,
  cook_member_id  uuid references app.member(id) on delete set null,
  status          text not null default 'planned'
                    check (status in ('planned','cooking','served','skipped')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table app.meal enable row level security;
alter table app.meal force row level security;

create index if not exists meal_household_idx
  on app.meal (household_id);

create index if not exists meal_household_planned_idx
  on app.meal (household_id, planned_for);

-- --------------------------------------------------------------------------
-- app.pantry_item
-- --------------------------------------------------------------------------

create table if not exists app.pantry_item (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references app.household(id) on delete cascade,
  name          text not null,
  quantity      numeric,
  unit          text,
  expires_on    date,
  location      text check (location in ('fridge','freezer','pantry')),
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table app.pantry_item enable row level security;
alter table app.pantry_item force row level security;

create index if not exists pantry_item_household_idx
  on app.pantry_item (household_id);

create index if not exists pantry_item_household_expires_idx
  on app.pantry_item (household_id, expires_on)
  where expires_on is not null;

-- --------------------------------------------------------------------------
-- app.grocery_list
-- --------------------------------------------------------------------------

create table if not exists app.grocery_list (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references app.household(id) on delete cascade,
  planned_for        date,
  status             text not null default 'draft'
                       check (status in ('draft','ordered','received','cancelled')),
  provider           text,
  external_order_id  text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table app.grocery_list enable row level security;
alter table app.grocery_list force row level security;

create index if not exists grocery_list_household_idx
  on app.grocery_list (household_id);

create index if not exists grocery_list_household_status_idx
  on app.grocery_list (household_id, status);

-- --------------------------------------------------------------------------
-- app.grocery_list_item
-- --------------------------------------------------------------------------

create table if not exists app.grocery_list_item (
  id              uuid primary key default gen_random_uuid(),
  list_id         uuid not null references app.grocery_list(id) on delete cascade,
  -- Denormalized household_id so RLS does not require an extra join.
  household_id    uuid not null references app.household(id) on delete cascade,
  name            text not null,
  quantity        numeric,
  unit            text,
  source_meal_id  uuid references app.meal(id) on delete set null,
  checked         boolean not null default false,
  created_at      timestamptz not null default now()
);

alter table app.grocery_list_item enable row level security;
alter table app.grocery_list_item force row level security;

create index if not exists grocery_list_item_list_idx
  on app.grocery_list_item (list_id);

create index if not exists grocery_list_item_household_idx
  on app.grocery_list_item (household_id);

-- --------------------------------------------------------------------------
-- RLS policies
-- --------------------------------------------------------------------------

drop policy if exists meal_read on app.meal;
create policy meal_read on app.meal
  for select
  using (app.can_read_segment(household_id, 'food'));

drop policy if exists meal_write on app.meal;
create policy meal_write on app.meal
  for all
  using (app.can_write_segment(household_id, 'food'))
  with check (app.can_write_segment(household_id, 'food'));

drop policy if exists pantry_item_read on app.pantry_item;
create policy pantry_item_read on app.pantry_item
  for select
  using (app.can_read_segment(household_id, 'food'));

drop policy if exists pantry_item_write on app.pantry_item;
create policy pantry_item_write on app.pantry_item
  for all
  using (app.can_write_segment(household_id, 'food'))
  with check (app.can_write_segment(household_id, 'food'));

drop policy if exists grocery_list_read on app.grocery_list;
create policy grocery_list_read on app.grocery_list
  for select
  using (app.can_read_segment(household_id, 'food'));

drop policy if exists grocery_list_write on app.grocery_list;
create policy grocery_list_write on app.grocery_list
  for all
  using (app.can_write_segment(household_id, 'food'))
  with check (app.can_write_segment(household_id, 'food'));

drop policy if exists grocery_list_item_read on app.grocery_list_item;
create policy grocery_list_item_read on app.grocery_list_item
  for select
  using (app.can_read_segment(household_id, 'food'));

drop policy if exists grocery_list_item_write on app.grocery_list_item;
create policy grocery_list_item_write on app.grocery_list_item
  for all
  using (app.can_write_segment(household_id, 'food'))
  with check (app.can_write_segment(household_id, 'food'));
