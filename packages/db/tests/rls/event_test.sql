-- RLS: app.event

-- 1) Alice reads all segments in House A.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from app.event where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n >= 4, 'event: Alice reads all House A events');
end $$;

-- 2) Bob cannot read House A events.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from app.event where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'event: Bob cannot read House A events');
end $$;

-- 3) Adam (none financial) cannot read financial events.
select public.act_as('22222222-2222-2222-2222-222222222222');
do $$
declare n int;
begin
  select count(*) into n from app.event
  where id = 'a0000003-0000-0000-0000-000000000000'; -- financial event
  perform public.rls_assert(n = 0, 'event: Adam cannot read financial event');
  -- Can read food event (has `read` on food).
  select count(*) into n from app.event
  where id = 'a0000004-0000-0000-0000-000000000000'; -- food event
  perform public.rls_assert(n = 1, 'event: Adam can read food event (read grant)');
end $$;

-- 4) Adam cannot insert into financial segment.
do $$
declare caught boolean := false;
begin
  begin
    insert into app.event (household_id, segment, kind, title, starts_at)
    values ('aaaaaaa1-0000-0000-0000-000000000000', 'financial', 'bill_due', 'Sneaky', now());
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'event: Adam cannot insert financial event');
end $$;

-- 5) Adam cannot insert into food either (has read but not write on food).
do $$
declare caught boolean := false;
begin
  begin
    insert into app.event (household_id, segment, kind, title, starts_at)
    values ('aaaaaaa1-0000-0000-0000-000000000000', 'food', 'meal', 'Sneaky Snack', now());
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'event: Adam cannot insert food event without write');
end $$;

select public.act_as_service();
