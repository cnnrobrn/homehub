-- RLS: mem.insight
--
-- Read by household members; writes are service-role only (reflection worker).

-- 1) Alice reads House A insights.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from mem.insight where id = 'a000002a-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 1, 'mem.insight: Alice reads House A insight');
end $$;

-- 2) Bob cannot read House A insights.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from mem.insight where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'mem.insight: Bob cannot read House A insights');
end $$;

-- 3) Alice cannot INSERT an insight.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare caught boolean := false;
begin
  begin
    insert into mem.insight (household_id, week_start, body_md)
    values ('aaaaaaa1-0000-0000-0000-000000000000',
            current_date, '# sneaky');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'mem.insight: member cannot INSERT');
end $$;

-- 4) Alice cannot UPDATE an insight (service role only).
do $$
declare n int;
begin
  update mem.insight set body_md = 'pwned'
  where id = 'a000002a-0000-0000-0000-000000000000';
  get diagnostics n = row_count;
  perform public.rls_assert(n = 0, 'mem.insight: member UPDATE refused');
end $$;

select public.act_as_service();
