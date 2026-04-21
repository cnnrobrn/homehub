-- RLS: mem.rule
--
-- Read by any household member; members INSERT/UPDATE/DELETE their OWN rules
-- only (author_member_id must match the caller's member_id).

-- 1) Alice reads House A rule.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from mem.rule where id = 'a0000029-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 1, 'mem.rule: Alice reads House A rule');
end $$;

-- 2) Bob cannot read House A rules.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from mem.rule where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'mem.rule: Bob cannot read House A rules');
end $$;

-- 3) Alice CAN INSERT a rule authored by herself.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  insert into mem.rule
    (household_id, author_member_id, description, predicate_dsl)
  values
    ('aaaaaaa1-0000-0000-0000-000000000000',
     'aaaaaaa1-1111-0000-0000-000000000000',
     'No takeout on school nights',
     '{"segment":"food"}'::jsonb);
  get diagnostics n = row_count;
  perform public.rls_assert(n = 1, 'mem.rule: owner Alice inserts her own rule');
end $$;

-- 4) Alice CANNOT INSERT a rule authored by Adam (someone else).
do $$
declare caught boolean := false;
begin
  begin
    insert into mem.rule
      (household_id, author_member_id, description, predicate_dsl)
    values
      ('aaaaaaa1-0000-0000-0000-000000000000',
       'aaaaaaa1-2222-0000-0000-000000000000',
       'Impersonated rule',
       '{"segment":"food"}'::jsonb);
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'mem.rule: cannot insert rule for another member');
end $$;

-- 5) Alice CAN UPDATE her own rule.
do $$
declare n int;
begin
  update mem.rule set description = description || ' (updated)'
  where id = 'a0000029-0000-0000-0000-000000000000';
  get diagnostics n = row_count;
  perform public.rls_assert(n = 1, 'mem.rule: Alice updates her own rule');
end $$;

-- 6) Adam CANNOT UPDATE Alice's rule.
select public.act_as('22222222-2222-2222-2222-222222222222');
do $$
declare n int;
begin
  update mem.rule set active = false
  where id = 'a0000029-0000-0000-0000-000000000000';
  get diagnostics n = row_count;
  perform public.rls_assert(n = 0, 'mem.rule: Adam cannot update Alice''s rule');
end $$;

-- 7) Bob (House B) cannot UPDATE House A rule.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  update mem.rule set active = false
  where id = 'a0000029-0000-0000-0000-000000000000';
  get diagnostics n = row_count;
  perform public.rls_assert(n = 0, 'mem.rule: out-of-household Bob cannot update');
end $$;

select public.act_as_service();
