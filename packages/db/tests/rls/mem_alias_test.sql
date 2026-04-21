-- RLS: mem.alias
--
-- Members read within-household aliases, may INSERT manual aliases,
-- cannot INSERT extractor/importer aliases (service role only).

-- 1) Alice reads her alias.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from mem.alias where id = 'a0000022-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 1, 'mem.alias: Alice reads House A alias');
end $$;

-- 2) Bob cannot read House A aliases.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from mem.alias where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'mem.alias: Bob cannot read House A aliases');
end $$;

-- 3) Alice CAN INSERT a manual alias on a House A node (policy allows source=manual).
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  insert into mem.alias (household_id, node_id, alias, source)
  values ('aaaaaaa1-0000-0000-0000-000000000000',
          'a0000020-0000-0000-0000-000000000000', 'Tikka', 'manual');
  get diagnostics n = row_count;
  perform public.rls_assert(n = 1, 'mem.alias: member inserts manual alias');
end $$;

-- 4) Alice CANNOT INSERT an extracted alias (service-role-only source).
do $$
declare caught boolean := false;
begin
  begin
    insert into mem.alias (household_id, node_id, alias, source)
    values ('aaaaaaa1-0000-0000-0000-000000000000',
            'a0000020-0000-0000-0000-000000000000', 'CtM2', 'extracted');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'mem.alias: member cannot insert extracted alias');
end $$;

-- 5) Alice cannot UPDATE an alias (service role only).
do $$
declare n int;
begin
  update mem.alias set alias = 'hijack' where id = 'a0000022-0000-0000-0000-000000000000';
  get diagnostics n = row_count;
  perform public.rls_assert(n = 0, 'mem.alias: member UPDATE is refused');
end $$;

-- 6) Bob cannot INSERT a manual alias on a House A node (household gate).
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare caught boolean := false;
begin
  begin
    insert into mem.alias (household_id, node_id, alias, source)
    values ('aaaaaaa1-0000-0000-0000-000000000000',
            'a0000020-0000-0000-0000-000000000000', 'Bobby Alias', 'manual');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'mem.alias: out-of-household member cannot insert alias');
end $$;

select public.act_as_service();
