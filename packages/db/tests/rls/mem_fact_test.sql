-- RLS: mem.fact
--
-- Read by household members; writes are service-role only.

-- 1) Alice reads House A facts.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from mem.fact where id = 'a0000026-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 1, 'mem.fact: Alice reads House A fact');
end $$;

-- 2) Bob cannot read House A facts.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from mem.fact where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'mem.fact: Bob cannot read House A facts');
end $$;

-- 3) Alice cannot INSERT a fact (service role only).
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare caught boolean := false;
begin
  begin
    insert into mem.fact
      (household_id, subject_node_id, predicate, object_value,
       confidence, valid_from, source)
    values
      ('aaaaaaa1-0000-0000-0000-000000000000',
       'a0000020-0000-0000-0000-000000000000', 'sneaky_predicate',
       '"x"'::jsonb, 0.5, now(), 'extraction');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'mem.fact: member cannot INSERT facts');
end $$;

-- 4) Alice cannot UPDATE a fact (e.g., fake a supersession).
do $$
declare n int;
begin
  update mem.fact set superseded_at = now()
  where id = 'a0000026-0000-0000-0000-000000000000';
  get diagnostics n = row_count;
  perform public.rls_assert(n = 0, 'mem.fact: member UPDATE refused');
end $$;

select public.act_as_service();
