-- RLS: mem.episode
--
-- Read by household members; writes are service-role only.

-- 1) Alice reads House A episode.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from mem.episode where id = 'a0000025-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 1, 'mem.episode: Alice reads House A episode');
end $$;

-- 2) Bob cannot read House A episodes.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from mem.episode where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'mem.episode: Bob cannot read House A episodes');
end $$;

-- 3) Alice cannot INSERT an episode (service role only).
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare caught boolean := false;
begin
  begin
    insert into mem.episode
      (household_id, title, occurred_at, source_type, source_id)
    values
      ('aaaaaaa1-0000-0000-0000-000000000000', 'Sneaky', now(),
       'conversation', '00000000-0000-0000-0000-000000000099');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'mem.episode: member cannot INSERT episodes');
end $$;

select public.act_as_service();
