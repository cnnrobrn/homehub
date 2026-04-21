-- RLS: app.pantry_item

-- 1) Alice reads.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from app.pantry_item where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n >= 1, 'pantry_item: Alice reads House A pantry');
end $$;

-- 2) Bob cannot read.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from app.pantry_item where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'pantry_item: Bob cannot read House A pantry');
end $$;

-- 3) Adam (read-only on food) cannot insert.
select public.act_as('22222222-2222-2222-2222-222222222222');
do $$
declare caught boolean := false;
begin
  begin
    insert into app.pantry_item (household_id, name, location)
    values ('aaaaaaa1-0000-0000-0000-000000000000', 'Sneaky Sugar', 'pantry');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'pantry_item: read-only Adam cannot insert');
end $$;

select public.act_as_service();
