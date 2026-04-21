-- RLS: mem.edge
--
-- Read by household members; writes are service-role only (workers).

-- 1) Alice reads the House A edge.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from mem.edge where id = 'a0000023-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 1, 'mem.edge: Alice reads House A edge');
end $$;

-- 2) Bob cannot read House A edges.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from mem.edge where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'mem.edge: Bob cannot read House A edges');
end $$;

-- 3) Alice cannot INSERT an edge (service role only).
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare caught boolean := false;
begin
  begin
    insert into mem.edge (household_id, src_id, dst_id, type)
    values ('aaaaaaa1-0000-0000-0000-000000000000',
            'a0000020-0000-0000-0000-000000000000',
            'a0000021-0000-0000-0000-000000000000',
            'related_to');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'mem.edge: member cannot INSERT edges');
end $$;

-- 4) Alice cannot UPDATE an edge weight.
do $$
declare n int;
begin
  update mem.edge set weight = 99 where id = 'a0000023-0000-0000-0000-000000000000';
  get diagnostics n = row_count;
  perform public.rls_assert(n = 0, 'mem.edge: member UPDATE is refused');
end $$;

select public.act_as_service();
