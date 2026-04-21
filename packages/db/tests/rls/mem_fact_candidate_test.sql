-- RLS: mem.fact_candidate
--
-- Read by household members; writes are service-role only (extractor writes,
-- reconciler mutates).

-- 1) Alice reads her candidate.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from mem.fact_candidate where id = 'a0000027-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 1, 'mem.fact_candidate: Alice reads House A candidate');
end $$;

-- 2) Bob cannot read House A candidates.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from mem.fact_candidate
  where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'mem.fact_candidate: Bob cannot read House A candidates');
end $$;

-- 3) Alice cannot INSERT a candidate.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare caught boolean := false;
begin
  begin
    insert into mem.fact_candidate
      (household_id, subject_node_id, predicate, source, status)
    values
      ('aaaaaaa1-0000-0000-0000-000000000000',
       'a0000020-0000-0000-0000-000000000000', 'sneaky', 'extraction', 'pending');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'mem.fact_candidate: member cannot INSERT');
end $$;

-- 4) Alice cannot UPDATE a candidate to promote it.
do $$
declare n int;
begin
  update mem.fact_candidate set status = 'promoted'
  where id = 'a0000027-0000-0000-0000-000000000000';
  get diagnostics n = row_count;
  perform public.rls_assert(n = 0, 'mem.fact_candidate: member UPDATE refused');
end $$;

select public.act_as_service();
