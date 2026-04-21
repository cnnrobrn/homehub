-- RLS: app.person

-- 1) Alice reads a person in House A.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from app.person where id = 'a0000010-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 1, 'person: Alice reads House A person');
end $$;

-- 2) Bob cannot read House A people.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from app.person where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'person: Bob cannot read House A people');
end $$;

-- 3) Adam has `read` on social, not `write`; cannot insert a new person.
select public.act_as('22222222-2222-2222-2222-222222222222');
do $$
declare caught boolean := false;
begin
  begin
    insert into app.person (household_id, display_name)
    values ('aaaaaaa1-0000-0000-0000-000000000000', 'Nope');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'person: read-only adult cannot insert person');
end $$;

-- 4) Alice (write on social) can insert a new person.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  insert into app.person (household_id, display_name)
  values ('aaaaaaa1-0000-0000-0000-000000000000', 'Uncle Ted');
  get diagnostics n = row_count;
  perform public.rls_assert(n = 1, 'person: Alice (write social) inserts person');
end $$;

select public.act_as_service();
