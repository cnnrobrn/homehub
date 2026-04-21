-- RLS: app.member

-- 1) Alice reads her own member row in House A.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from app.member where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n >= 1, 'member: Alice sees members of House A');
end $$;

-- 2) Alice cannot read members of House B.
do $$
declare n int;
begin
  select count(*) into n from app.member where household_id = 'bbbbbbb1-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'member: Alice cannot read House B members');
end $$;

-- 3) Adult (Adam) cannot insert a new member row into House A.
select public.act_as('22222222-2222-2222-2222-222222222222');
do $$
declare caught boolean := false;
begin
  begin
    insert into app.member (household_id, display_name, role)
    values ('aaaaaaa1-0000-0000-0000-000000000000', 'Imposter', 'adult');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'member: adult Adam cannot insert into House A');
end $$;

-- 4) Owner (Alice) can insert a non-connected member in House A.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  insert into app.member (household_id, display_name, role)
  values ('aaaaaaa1-0000-0000-0000-000000000000', 'Grandma (invitee)', 'non_connected');
  get diagnostics n = row_count;
  perform public.rls_assert(n = 1, 'member: owner Alice can insert non_connected into House A');
end $$;

select public.act_as_service();
