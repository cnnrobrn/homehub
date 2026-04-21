-- RLS: app.action

-- 1) Alice reads the action.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from app.action where id = 'a000000e-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 1, 'action: Alice reads House A action');
end $$;

-- 2) Bob cannot.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from app.action where id = 'a000000e-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'action: Bob cannot read House A action');
end $$;

-- 3) Adam (none financial) cannot insert a financial action.
select public.act_as('22222222-2222-2222-2222-222222222222');
do $$
declare caught boolean := false;
begin
  begin
    insert into app.action (household_id, segment, kind)
    values ('aaaaaaa1-0000-0000-0000-000000000000', 'financial', 'transfer_funds');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'action: Adam cannot insert financial action');
end $$;

-- 4) Alice (write financial) can insert a pending action.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  insert into app.action (household_id, segment, kind, status)
  values ('aaaaaaa1-0000-0000-0000-000000000000', 'financial', 'transfer_funds', 'pending');
  get diagnostics n = row_count;
  perform public.rls_assert(n = 1, 'action: Alice can insert pending financial action');
end $$;

-- 5) Even Alice cannot directly UPDATE status (service-role only).
do $$
declare n int;
begin
  update app.action set status = 'running'
  where id = 'a000000e-0000-0000-0000-000000000000';
  get diagnostics n = row_count;
  perform public.rls_assert(n = 0, 'action: Alice cannot UPDATE action status (service-role only)');
end $$;

-- 6) Status-transition trigger refuses illegal transitions (service role).
select public.act_as_service();
do $$
declare caught boolean := false;
begin
  begin
    update app.action set status = 'succeeded'
    where id = 'a000000e-0000-0000-0000-000000000000'; -- was 'pending'
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'action: trigger refuses pending -> succeeded');
end $$;
