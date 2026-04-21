-- RLS: mem.pattern
--
-- Read by household members; writes are service-role only.

-- 1) Alice reads House A patterns.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from mem.pattern where id = 'a0000028-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 1, 'mem.pattern: Alice reads House A pattern');
end $$;

-- 2) Bob cannot read House A patterns.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from mem.pattern where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'mem.pattern: Bob cannot read House A patterns');
end $$;

-- 3) Alice cannot INSERT a pattern.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare caught boolean := false;
begin
  begin
    insert into mem.pattern
      (household_id, kind, description, confidence, sample_size,
       observed_from, observed_to)
    values
      ('aaaaaaa1-0000-0000-0000-000000000000', 'temporal', 'sneaky',
       0.5, 3, now() - interval '30 days', now());
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'mem.pattern: member cannot INSERT patterns');
end $$;

select public.act_as_service();
