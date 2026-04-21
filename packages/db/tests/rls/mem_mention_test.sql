-- RLS: mem.mention
--
-- Read by household members; writes are service-role only (workers).

-- 1) Alice reads House A mentions.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from mem.mention where id = 'a0000024-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 1, 'mem.mention: Alice reads House A mention');
end $$;

-- 2) Bob cannot read House A mentions.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from mem.mention where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'mem.mention: Bob cannot read House A mentions');
end $$;

-- 3) Alice cannot INSERT a mention (service role only).
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare caught boolean := false;
begin
  begin
    insert into mem.mention (household_id, node_id, row_table, row_id)
    values ('aaaaaaa1-0000-0000-0000-000000000000',
            'a0000020-0000-0000-0000-000000000000',
            'app.meal',
            'a0000008-0000-0000-0000-000000000000');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'mem.mention: member cannot INSERT mentions');
end $$;

select public.act_as_service();
