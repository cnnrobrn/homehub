-- RLS: app.budget

-- 1) Alice (write financial) reads her budget.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from app.budget where id = 'a0000002-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 1, 'budget: Alice reads House A budget');
end $$;

-- 2) Bob cannot read House A budget.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from app.budget where id = 'a0000002-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'budget: Bob cannot read House A budget');
end $$;

-- 3) Adam (none on financial) cannot read or insert.
select public.act_as('22222222-2222-2222-2222-222222222222');
do $$
declare n int;
declare caught boolean := false;
begin
  select count(*) into n from app.budget where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'budget: Adam (none financial) cannot read budget');
  begin
    insert into app.budget (household_id, name, period, category, amount_cents)
    values ('aaaaaaa1-0000-0000-0000-000000000000', 'Adam Secret', 'monthly', 'x', 1);
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'budget: Adam cannot insert without financial write');
end $$;

select public.act_as_service();
