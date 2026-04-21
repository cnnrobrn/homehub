-- RLS: app.alert

-- 1) Alice (write financial) reads the alert.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from app.alert where id = 'a000000c-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 1, 'alert: Alice reads House A alert');
end $$;

-- 2) Bob cannot read.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from app.alert where id = 'a000000c-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'alert: Bob cannot read House A alert');
end $$;

-- 3) Adam (none financial) cannot read or dismiss.
select public.act_as('22222222-2222-2222-2222-222222222222');
do $$
declare n int;
declare caught boolean := false;
begin
  select count(*) into n from app.alert where id = 'a000000c-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'alert: Adam (none financial) cannot read financial alert');
end $$;

-- 4) Any authenticated user cannot INSERT (service-role only).
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare caught boolean := false;
begin
  begin
    insert into app.alert (household_id, segment, severity, title, body, generated_by)
    values ('aaaaaaa1-0000-0000-0000-000000000000', 'financial', 'info', 'x', 'y', 'test');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'alert: even owner Alice cannot INSERT (service-role only)');
end $$;

select public.act_as_service();
