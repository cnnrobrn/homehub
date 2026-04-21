-- RLS: mem.node
--
-- Members read within-household nodes; service-role-only full writes;
-- members may UPDATE the curated columns (manual_notes_md, needs_review).

-- 1) Alice (House A) reads her node.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from mem.node where id = 'a0000020-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 1, 'mem.node: Alice reads House A dish node');
end $$;

-- 2) Bob (House B) cannot read House A nodes.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from mem.node where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'mem.node: Bob cannot read House A nodes');
end $$;

-- 3) Alice cannot INSERT a node (service-role only).
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare caught boolean := false;
begin
  begin
    insert into mem.node (household_id, type, canonical_name)
    values ('aaaaaaa1-0000-0000-0000-000000000000', 'dish', 'Sneaky Dish');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'mem.node: members cannot INSERT nodes');
end $$;

-- 4) Alice CAN UPDATE manual_notes_md (curated field).
do $$
declare n int;
begin
  update mem.node set manual_notes_md = 'Great for weeknights', needs_review = true
  where id = 'a0000020-0000-0000-0000-000000000000';
  get diagnostics n = row_count;
  perform public.rls_assert(n = 1, 'mem.node: member updates manual_notes_md + needs_review');
end $$;

-- 5) Alice CANNOT UPDATE canonical_name (trigger guard rejects).
do $$
declare caught boolean := false;
begin
  begin
    update mem.node set canonical_name = 'Hijacked'
    where id = 'a0000020-0000-0000-0000-000000000000';
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'mem.node: member cannot rename canonical_name');
end $$;

-- 6) Alice cannot DELETE nodes (no delete policy for authenticated).
do $$
declare n int;
begin
  delete from mem.node where id = 'a0000020-0000-0000-0000-000000000000';
  get diagnostics n = row_count;
  perform public.rls_assert(n = 0, 'mem.node: member delete is refused (0 rows)');
end $$;

select public.act_as_service();
