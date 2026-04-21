-- RLS: app.suggestion

-- 1) Alice reads the suggestion.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from app.suggestion where id = 'a000000d-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 1, 'suggestion: Alice reads House A suggestion');
end $$;

-- 2) Bob cannot.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from app.suggestion where id = 'a000000d-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'suggestion: Bob cannot read House A suggestion');
end $$;

-- 3) Adam (none financial) cannot read.
select public.act_as('22222222-2222-2222-2222-222222222222');
do $$
declare n int;
begin
  select count(*) into n from app.suggestion where id = 'a000000d-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'suggestion: Adam cannot read financial suggestion');
end $$;

-- 4) No authenticated user can INSERT (service-role only).
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare caught boolean := false;
begin
  begin
    insert into app.suggestion (household_id, segment, kind, title, rationale)
    values ('aaaaaaa1-0000-0000-0000-000000000000', 'financial', 'transfer_funds', 'x', 'y');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'suggestion: even owner Alice cannot INSERT (service-role only)');
end $$;

select public.act_as_service();
