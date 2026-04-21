-- RLS: app.meal

-- 1) Alice reads House A meals.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from app.meal where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n >= 1, 'meal: Alice reads House A meals');
end $$;

-- 2) Bob cannot read House A meals.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from app.meal where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'meal: Bob cannot read House A meals');
end $$;

-- 3) Adam (read on food but not write) cannot insert.
select public.act_as('22222222-2222-2222-2222-222222222222');
do $$
declare caught boolean := false;
declare n int;
begin
  select count(*) into n from app.meal where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n >= 1, 'meal: Adam can read food meals');
  begin
    insert into app.meal (household_id, planned_for, slot, title)
    values ('aaaaaaa1-0000-0000-0000-000000000000', current_date, 'lunch', 'Sneaky');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'meal: Adam cannot insert without food write');
end $$;

select public.act_as_service();
