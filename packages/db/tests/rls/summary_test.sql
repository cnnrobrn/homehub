-- RLS: app.summary

-- 1) Alice reads.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from app.summary where id = 'a000000f-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 1, 'summary: Alice reads House A summary');
end $$;

-- 2) Bob cannot.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from app.summary where id = 'a000000f-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'summary: Bob cannot read House A summary');
end $$;

-- 3) No authenticated INSERT (service-role only).
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare caught boolean := false;
begin
  begin
    insert into app.summary (household_id, segment, period, covered_start, covered_end, body_md, model)
    values ('aaaaaaa1-0000-0000-0000-000000000000', 'financial', 'weekly',
            now(), now(), 'x', 'm');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'summary: even Alice cannot INSERT (service-role only)');
end $$;

select public.act_as_service();
