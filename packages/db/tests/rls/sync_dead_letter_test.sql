-- RLS: sync.dead_letter
--
-- Service-role only for both read and write. No authenticated policies
-- means no rows are visible to JWT roles.

-- 1) Service role can read (sanity check — already implicitly trusted).
select public.act_as_service();
do $$
declare n int;
begin
  select count(*) into n from sync.dead_letter;
  perform public.rls_assert(n >= 1, 'dead_letter: service role reads DLQ');
end $$;

-- 2) Authenticated user (even owner) cannot read.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from sync.dead_letter;
  perform public.rls_assert(n = 0, 'dead_letter: owner Alice cannot read DLQ');
end $$;

-- 3) Authenticated user cannot insert.
do $$
declare caught boolean := false;
begin
  begin
    insert into sync.dead_letter (queue, payload, error)
    values ('x', '{}'::jsonb, 'sneaky');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'dead_letter: authenticated cannot insert into DLQ');
end $$;

select public.act_as_service();
