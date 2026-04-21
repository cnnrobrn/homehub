-- RLS: app.email

-- 1) Alice reads all of House A's emails (owner, all segments write).
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from app.email
  where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n >= 2, 'email: Alice reads all House A emails');
end $$;

-- 2) Bob (House B) cannot read House A's emails.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from app.email
  where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'email: Bob cannot read House A emails');
end $$;

-- 3) Adam (read on system, none on financial) can read the 'system' email
--    but not the 'financial'-reclassified receipt.
select public.act_as('22222222-2222-2222-2222-222222222222');
do $$
declare n int;
begin
  -- System email — visible.
  select count(*) into n from app.email
  where id = 'a0000030-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 1, 'email: Adam reads system-segment email');

  -- Financial email — hidden.
  select count(*) into n from app.email
  where id = 'a0000031-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'email: Adam cannot read financial-segment email');
end $$;

-- 4) Even Alice (authenticated, full grants) cannot INSERT into app.email.
--    Writes are service-role only; force row level security blocks
--    authenticated writes regardless of grants.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare caught boolean := false;
begin
  begin
    insert into app.email
      (household_id, provider, source_id, received_at)
    values
      ('aaaaaaa1-0000-0000-0000-000000000000', 'gmail',
       'gmail-msg-sneaky', now());
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'email: authenticated cannot INSERT (service-role only)');
end $$;

-- 5) Adam cannot UPDATE an email he can read either (no UPDATE policy
--    exists for authenticated; system segment read grant doesn't imply
--    write on app.email).
select public.act_as('22222222-2222-2222-2222-222222222222');
do $$
declare affected int;
begin
  update app.email set subject = 'tampered'
  where id = 'a0000030-0000-0000-0000-000000000000';
  get diagnostics affected = row_count;
  perform public.rls_assert(affected = 0,
    'email: Adam cannot UPDATE readable email (no authenticated write policy)');
end $$;

select public.act_as_service();
