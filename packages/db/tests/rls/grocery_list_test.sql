-- RLS: app.grocery_list + app.grocery_list_item

-- 1) Alice reads the list.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from app.grocery_list where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n >= 1, 'grocery_list: Alice reads list');
end $$;

-- 2) Bob cannot.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from app.grocery_list where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'grocery_list: Bob cannot read House A list');
end $$;

-- 3) Adam cannot insert a new list or item (read-only on food).
select public.act_as('22222222-2222-2222-2222-222222222222');
do $$
declare caught boolean := false;
begin
  begin
    insert into app.grocery_list (household_id, planned_for)
    values ('aaaaaaa1-0000-0000-0000-000000000000', current_date);
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'grocery_list: read-only Adam cannot insert list');
end $$;

do $$
declare caught boolean := false;
begin
  begin
    insert into app.grocery_list_item (list_id, household_id, name)
    values ('a000000a-0000-0000-0000-000000000000',
            'aaaaaaa1-0000-0000-0000-000000000000', 'Sneaky');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'grocery_list_item: read-only Adam cannot insert item');
end $$;

select public.act_as_service();
