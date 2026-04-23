-- Supabase Storage bucket + RLS for per-household Hermes state.
--
-- Each chat turn's sandbox hydrates its ${HERMES_HOME} from
-- gs://hermes-state/<household_id>/state.tar.gz equivalent in Supabase
-- Storage, runs Hermes, then uploads a fresh tarball. The router
-- authenticates the sandbox with a short-lived household-scoped JWT
-- (minted by apps/hermes-router/src/jwt.ts), so Storage RLS can scope
-- reads/writes to paths prefixed by the household_id claim.

insert into storage.buckets (id, name, public)
values ('hermes-state', 'hermes-state', false)
on conflict (id) do nothing;

-- Enable row-level security on storage.objects is done globally by
-- Supabase. We only add policies here.

-- The RLS check: the first path segment must match the household_id
-- claim in the JWT. We store objects at `<household_id>/state.tar.gz`
-- and let the household JWT authorize access.

drop policy if exists "hermes_state_household_read" on storage.objects;
create policy "hermes_state_household_read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'hermes-state'
    and (auth.jwt() ->> 'household_id') is not null
    and split_part(name, '/', 1) = (auth.jwt() ->> 'household_id')
  );

drop policy if exists "hermes_state_household_write" on storage.objects;
create policy "hermes_state_household_write"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'hermes-state'
    and (auth.jwt() ->> 'household_id') is not null
    and split_part(name, '/', 1) = (auth.jwt() ->> 'household_id')
  );

drop policy if exists "hermes_state_household_update" on storage.objects;
create policy "hermes_state_household_update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'hermes-state'
    and (auth.jwt() ->> 'household_id') is not null
    and split_part(name, '/', 1) = (auth.jwt() ->> 'household_id')
  );

drop policy if exists "hermes_state_household_delete" on storage.objects;
create policy "hermes_state_household_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'hermes-state'
    and (auth.jwt() ->> 'household_id') is not null
    and split_part(name, '/', 1) = (auth.jwt() ->> 'household_id')
  );
