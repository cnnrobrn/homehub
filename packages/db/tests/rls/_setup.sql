-- RLS test fixture setup.
--
-- Seeds two households (A, B) with:
--   - Household A: alice_owner (owner, all grants write), adam_adult
--                  (adult, read on social/food, none on financial).
--   - Household B: bob_owner (owner, all grants write).
--
-- Plus one fixture row per app.* / sync.* table owned by household A so
-- tests can reference a canonical id without re-creating fixtures in
-- each file. Household B gets a matching account + event + transaction
-- so cross-household denial can be asserted symmetrically.
--
-- All ids are fixed UUIDs so assertions reference them literally.
--
-- Runs as service_role so no policy gate applies. Idempotent: each
-- insert uses `on conflict do nothing` so re-running after a partial
-- apply just updates nothing.

-- -------- auth.users ----------------------------------------------------
-- Alice = owner of A; Adam = adult in A; Bob = owner of B.
--
-- Seed these fixture users as the postgres connection role (the role
-- rls-test.sh connects as). Supabase CLI 2.90.0 runs local Postgres 17
-- with `postgres` as a non-superuser, so we can't SET ROLE to
-- supabase_auth_admin or GRANT INSERT on auth.users to service_role.
-- But `postgres` still holds INSERT on auth.users directly (just not
-- GRANT OPTION on it). Insert first, *then* switch to service_role for
-- the rest of the fixture so app.* RLS is bypassed as before.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test'),
  ('22222222-2222-2222-2222-222222222222', 'adam@test'),
  ('33333333-3333-3333-3333-333333333333', 'bob@test')
on conflict (id) do nothing;

select public.act_as_service();

-- -------- households ---------------------------------------------------
insert into app.household (id, name, created_by) values
  ('aaaaaaa1-0000-0000-0000-000000000000', 'House A', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbb1-0000-0000-0000-000000000000', 'House B', '33333333-3333-3333-3333-333333333333')
on conflict (id) do nothing;

-- -------- members ------------------------------------------------------
insert into app.member (id, household_id, user_id, display_name, role, joined_at) values
  ('aaaaaaa1-1111-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   '11111111-1111-1111-1111-111111111111', 'Alice', 'owner', now()),
  ('aaaaaaa1-2222-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   '22222222-2222-2222-2222-222222222222', 'Adam',  'adult', now()),
  ('bbbbbbb1-1111-0000-0000-000000000000', 'bbbbbbb1-0000-0000-0000-000000000000',
   '33333333-3333-3333-3333-333333333333', 'Bob',   'owner', now())
on conflict (id) do nothing;

-- -------- segment grants -----------------------------------------------
-- Alice (owner of A): write on every segment.
insert into app.member_segment_grant (member_id, segment, access) values
  ('aaaaaaa1-1111-0000-0000-000000000000', 'financial', 'write'),
  ('aaaaaaa1-1111-0000-0000-000000000000', 'food',      'write'),
  ('aaaaaaa1-1111-0000-0000-000000000000', 'fun',       'write'),
  ('aaaaaaa1-1111-0000-0000-000000000000', 'social',    'write'),
  ('aaaaaaa1-1111-0000-0000-000000000000', 'system',    'write')
on conflict (member_id, segment) do nothing;

-- Adam (adult in A): read-only on social/food, none on financial. Useful
-- for testing "write without grant" denials on food/financial.
insert into app.member_segment_grant (member_id, segment, access) values
  ('aaaaaaa1-2222-0000-0000-000000000000', 'financial', 'none'),
  ('aaaaaaa1-2222-0000-0000-000000000000', 'food',      'read'),
  ('aaaaaaa1-2222-0000-0000-000000000000', 'fun',       'read'),
  ('aaaaaaa1-2222-0000-0000-000000000000', 'social',    'read'),
  ('aaaaaaa1-2222-0000-0000-000000000000', 'system',    'read')
on conflict (member_id, segment) do nothing;

-- Bob (owner of B): write on every segment.
insert into app.member_segment_grant (member_id, segment, access) values
  ('bbbbbbb1-1111-0000-0000-000000000000', 'financial', 'write'),
  ('bbbbbbb1-1111-0000-0000-000000000000', 'food',      'write'),
  ('bbbbbbb1-1111-0000-0000-000000000000', 'fun',       'write'),
  ('bbbbbbb1-1111-0000-0000-000000000000', 'social',    'write'),
  ('bbbbbbb1-1111-0000-0000-000000000000', 'system',    'write')
on conflict (member_id, segment) do nothing;

-- -------- accounts -----------------------------------------------------
insert into app.account (id, household_id, owner_member_id, kind, name) values
  ('a0000001-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'aaaaaaa1-1111-0000-0000-000000000000', 'checking', 'Alice Checking'),
  ('b0000001-0000-0000-0000-000000000000', 'bbbbbbb1-0000-0000-0000-000000000000',
   'bbbbbbb1-1111-0000-0000-000000000000', 'checking', 'Bob Checking')
on conflict (id) do nothing;

-- -------- budgets ------------------------------------------------------
insert into app.budget (id, household_id, name, period, category, amount_cents) values
  ('a0000002-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'Groceries', 'monthly', 'groceries', 50000)
on conflict (id) do nothing;

-- -------- events -------------------------------------------------------
-- One event per segment for household A so segment-gated tests have
-- something to read.
insert into app.event (id, household_id, segment, kind, title, starts_at) values
  ('a0000003-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'financial', 'bill_due', 'Rent Due', now() + interval '3 days'),
  ('a0000004-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'food', 'meal', 'Family Dinner', now() + interval '1 day'),
  ('a0000005-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'fun', 'reservation', 'Concert', now() + interval '5 days'),
  ('a0000006-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'social', 'birthday', 'Kid Birthday', now() + interval '10 days'),
  ('b0000003-0000-0000-0000-000000000000', 'bbbbbbb1-0000-0000-0000-000000000000',
   'financial', 'bill_due', 'B Rent Due', now() + interval '3 days')
on conflict (id) do nothing;

-- -------- transactions -------------------------------------------------
insert into app.transaction (id, household_id, occurred_at, amount_cents, source, account_id) values
  ('a0000007-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   now(), -2500, 'manual', 'a0000001-0000-0000-0000-000000000000'),
  ('b0000007-0000-0000-0000-000000000000', 'bbbbbbb1-0000-0000-0000-000000000000',
   now(), -1500, 'manual', 'b0000001-0000-0000-0000-000000000000')
on conflict (id) do nothing;

-- -------- meal / pantry / grocery --------------------------------------
insert into app.meal (id, household_id, planned_for, slot, title) values
  ('a0000008-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   current_date, 'dinner', 'Pasta')
on conflict (id) do nothing;

insert into app.pantry_item (id, household_id, name, location) values
  ('a0000009-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'Flour', 'pantry')
on conflict (id) do nothing;

insert into app.grocery_list (id, household_id, planned_for) values
  ('a000000a-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   current_date)
on conflict (id) do nothing;

insert into app.grocery_list_item (id, list_id, household_id, name) values
  ('a000000b-0000-0000-0000-000000000000', 'a000000a-0000-0000-0000-000000000000',
   'aaaaaaa1-0000-0000-0000-000000000000', 'Milk')
on conflict (id) do nothing;

-- -------- alerts / suggestions / actions / summaries ------------------
insert into app.alert (id, household_id, segment, severity, title, body, generated_by) values
  ('a000000c-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'financial', 'warn', 'Big charge', 'You were charged $500', 'test')
on conflict (id) do nothing;

insert into app.suggestion (id, household_id, segment, kind, title, rationale) values
  ('a000000d-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'financial', 'transfer_funds', 'Move $200 to savings', 'Monthly surplus detected')
on conflict (id) do nothing;

insert into app.action (id, household_id, segment, kind, created_by) values
  ('a000000e-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'financial', 'transfer_funds', 'aaaaaaa1-1111-0000-0000-000000000000')
on conflict (id) do nothing;

insert into app.summary (id, household_id, segment, period, covered_start, covered_end, body_md, model) values
  ('a000000f-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'financial', 'weekly', now() - interval '7 days', now(), '# Summary', 'test-model')
on conflict (id) do nothing;

-- -------- person -------------------------------------------------------
insert into app.person (id, household_id, display_name) values
  ('a0000010-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000', 'Grandma')
on conflict (id) do nothing;

-- -------- household_invitation ----------------------------------------
insert into app.household_invitation
  (id, household_id, email, role, token_hash, expires_at, invited_by)
values
  ('a0000011-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'invitee@test', 'adult', 'hash-of-test-token', now() + interval '7 days',
   'aaaaaaa1-1111-0000-0000-000000000000')
on conflict (id) do nothing;

-- -------- account_grant (roommate case) -------------------------------
-- Adam gets explicit `none` on Alice's account; used by account tests
-- and transaction-on-account-grant tests.
insert into app.account_grant (account_id, member_id, access) values
  ('a0000001-0000-0000-0000-000000000000', 'aaaaaaa1-2222-0000-0000-000000000000', 'none')
on conflict (account_id, member_id) do nothing;

-- -------- conversation -------------------------------------------------
insert into app.conversation (id, household_id, title, created_by) values
  ('a0000012-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'Dinner plans', 'aaaaaaa1-1111-0000-0000-000000000000')
on conflict (id) do nothing;

insert into app.conversation_turn
  (id, conversation_id, household_id, author_member_id, role, body_md)
values
  ('a0000013-0000-0000-0000-000000000000', 'a0000012-0000-0000-0000-000000000000',
   'aaaaaaa1-0000-0000-0000-000000000000', 'aaaaaaa1-1111-0000-0000-000000000000',
   'member', 'What are we eating?')
on conflict (id) do nothing;

-- -------- sync / audit / model_calls ----------------------------------
insert into sync.provider_connection
  (id, household_id, member_id, provider, nango_connection_id, status)
values
  ('a0000014-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'aaaaaaa1-1111-0000-0000-000000000000', 'google-calendar', 'nango-a-gcal', 'active')
on conflict (id) do nothing;

insert into sync.cursor (id, connection_id, kind, value) values
  ('a0000015-0000-0000-0000-000000000000', 'a0000014-0000-0000-0000-000000000000',
   'sync_token', 'abc')
on conflict (id) do nothing;

insert into sync.dead_letter (id, connection_id, queue, payload, error) values
  ('a0000016-0000-0000-0000-000000000000', 'a0000014-0000-0000-0000-000000000000',
   'sync_gcal', '{"raw":"x"}'::jsonb, 'bad shape')
on conflict (id) do nothing;

insert into audit.event (id, household_id, actor_user_id, action, resource_type, resource_id) values
  ('a0000017-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   '11111111-1111-1111-1111-111111111111', 'create', 'event',
   'a0000003-0000-0000-0000-000000000000')
on conflict (id) do nothing;

insert into app.model_calls (id, household_id, task, model, input_tokens, output_tokens, cost_usd) values
  ('a0000018-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'enrich_event', 'kimi-k2', 100, 50, 0.001234)
on conflict (id) do nothing;

-- -------- mem.node -----------------------------------------------------
-- One canonical node per household so cross-household denial tests have
-- symmetric targets. Household A gets a second node (ingredient) so the
-- edge fixture has two nodes to connect.
insert into mem.node (id, household_id, type, canonical_name) values
  ('a0000020-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'dish', 'Chicken Tikka Masala'),
  ('a0000021-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'ingredient', 'Paneer'),
  ('b0000020-0000-0000-0000-000000000000', 'bbbbbbb1-0000-0000-0000-000000000000',
   'dish', 'Beef Stew')
on conflict (id) do nothing;

-- -------- mem.alias ----------------------------------------------------
insert into mem.alias (id, household_id, node_id, alias, source) values
  ('a0000022-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'a0000020-0000-0000-0000-000000000000', 'CTM', 'extracted'),
  ('b0000022-0000-0000-0000-000000000000', 'bbbbbbb1-0000-0000-0000-000000000000',
   'b0000020-0000-0000-0000-000000000000', 'Stew', 'extracted')
on conflict (id) do nothing;

-- -------- mem.edge -----------------------------------------------------
insert into mem.edge (id, household_id, src_id, dst_id, type) values
  ('a0000023-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'a0000020-0000-0000-0000-000000000000', 'a0000021-0000-0000-0000-000000000000',
   'contains')
on conflict (id) do nothing;

-- -------- mem.mention --------------------------------------------------
insert into mem.mention (id, household_id, node_id, row_table, row_id) values
  ('a0000024-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'a0000020-0000-0000-0000-000000000000', 'app.meal',
   'a0000008-0000-0000-0000-000000000000')
on conflict (id) do nothing;

-- -------- mem.episode --------------------------------------------------
insert into mem.episode
  (id, household_id, title, occurred_at, source_type, source_id)
values
  ('a0000025-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'Dinner with the Garcias', now() - interval '1 day', 'meal',
   'a0000008-0000-0000-0000-000000000000'),
  ('b0000025-0000-0000-0000-000000000000', 'bbbbbbb1-0000-0000-0000-000000000000',
   'Bob Family Dinner', now() - interval '1 day', 'meal',
   '00000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- -------- mem.fact -----------------------------------------------------
insert into mem.fact
  (id, household_id, subject_node_id, predicate, object_value,
   confidence, valid_from, source)
values
  ('a0000026-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'a0000020-0000-0000-0000-000000000000', 'contains',
   '["paneer"]'::jsonb, 0.92, now() - interval '30 days', 'extraction'),
  ('b0000026-0000-0000-0000-000000000000', 'bbbbbbb1-0000-0000-0000-000000000000',
   'b0000020-0000-0000-0000-000000000000', 'contains',
   '["beef"]'::jsonb, 0.88, now() - interval '30 days', 'extraction')
on conflict (id) do nothing;

-- -------- mem.fact_candidate -------------------------------------------
insert into mem.fact_candidate
  (id, household_id, subject_node_id, predicate, object_value,
   confidence, valid_from, source, status)
values
  ('a0000027-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'a0000020-0000-0000-0000-000000000000', 'prefers_spice',
   '"medium"'::jsonb, 0.6, now() - interval '2 days', 'extraction', 'pending')
on conflict (id) do nothing;

-- -------- mem.pattern --------------------------------------------------
insert into mem.pattern
  (id, household_id, kind, description, confidence, sample_size,
   observed_from, observed_to)
values
  ('a0000028-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'temporal', 'Alice cooks on Sunday evenings', 0.8, 6,
   now() - interval '60 days', now())
on conflict (id) do nothing;

-- -------- mem.rule -----------------------------------------------------
-- Alice (owner, house A) authors a rule. Bob's (house B) rule used for
-- cross-household denial tests.
insert into mem.rule
  (id, household_id, author_member_id, description, predicate_dsl)
values
  ('a0000029-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'aaaaaaa1-1111-0000-0000-000000000000',
   'No grocery orders after 9pm on weekdays',
   '{"segment":"food","condition":"weekday_late_evening"}'::jsonb),
  ('b0000029-0000-0000-0000-000000000000', 'bbbbbbb1-0000-0000-0000-000000000000',
   'bbbbbbb1-1111-0000-0000-000000000000',
   'No subscription charges over $20',
   '{"segment":"financial","condition":"subscription_over_20"}'::jsonb)
on conflict (id) do nothing;

-- -------- mem.insight --------------------------------------------------
insert into mem.insight
  (id, household_id, week_start, body_md)
values
  ('a000002a-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   current_date - 7, '# Weekly insight\n- Grocery spend down 8%')
on conflict (id) do nothing;

-- -------- app.email / app.email_attachment (M4-A) ----------------------
-- One ingested Gmail message per household so cross-household denial
-- tests have symmetric targets. Household A gets two rows so the
-- segment-gating assertion (Adam cannot read a financial email while he
-- can read a system email) has both targets in the fixture.
--
-- Segments chosen:
--   - Household A, 'system'   — default post-sync segment. Adam has
--     read on system in his grants, so this row is visible to Adam.
--   - Household A, 'financial'— post-extraction reclassification (a
--     receipt). Adam has 'none' on financial; denial asserted.
--   - Household B, 'system'   — cross-household denial target.
insert into app.email
  (id, household_id, member_id, connection_id, provider, source_id,
   subject, from_email, received_at, categories, segment)
values
  ('a0000030-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'aaaaaaa1-1111-0000-0000-000000000000',
   'a0000014-0000-0000-0000-000000000000',
   'gmail', 'gmail-msg-a-system-001',
   'Welcome to HomeHub', 'noreply@homehub.test',
   now() - interval '1 hour', array[]::text[], 'system'),
  ('a0000031-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'aaaaaaa1-1111-0000-0000-000000000000',
   'a0000014-0000-0000-0000-000000000000',
   'gmail', 'gmail-msg-a-financial-001',
   'Receipt from Whole Foods', 'receipts@wholefoods.test',
   now() - interval '2 hours', array['receipt']::text[], 'financial'),
  ('b0000030-0000-0000-0000-000000000000', 'bbbbbbb1-0000-0000-0000-000000000000',
   'bbbbbbb1-1111-0000-0000-000000000000', null,
   'gmail', 'gmail-msg-b-system-001',
   'Bob welcome', 'noreply@homehub.test',
   now() - interval '1 hour', array[]::text[], 'system')
on conflict (household_id, provider, source_id) do nothing;

insert into app.email_attachment
  (id, household_id, email_id, filename, content_type, size_bytes,
   storage_path)
values
  -- Attachment on House A's financial (receipt) email — gated through
  -- the financial segment.
  ('a0000032-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'a0000031-0000-0000-0000-000000000000',
   'receipt.pdf', 'application/pdf', 12345,
   'aaaaaaa1-0000-0000-0000-000000000000/email/a0000031-0000-0000-0000-000000000000/att-001'),
  -- Attachment on House A's system email — visible to Adam (system read).
  ('a0000033-0000-0000-0000-000000000000', 'aaaaaaa1-0000-0000-0000-000000000000',
   'a0000030-0000-0000-0000-000000000000',
   'welcome.pdf', 'application/pdf', 2048,
   'aaaaaaa1-0000-0000-0000-000000000000/email/a0000030-0000-0000-0000-000000000000/att-002'),
  -- Attachment on Bob's email — cross-household denial target.
  ('b0000032-0000-0000-0000-000000000000', 'bbbbbbb1-0000-0000-0000-000000000000',
   'b0000030-0000-0000-0000-000000000000',
   'bob.pdf', 'application/pdf', 512,
   'bbbbbbb1-0000-0000-0000-000000000000/email/b0000030-0000-0000-0000-000000000000/att-003')
on conflict (storage_path) do nothing;
