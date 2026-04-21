-- RLS: sync.cursor
--
-- Service-role only.

-- 1) Service role reads.
select public.act_as_service();
do $$
declare n int;
begin
  select count(*) into n from sync.cursor;
  perform public.rls_assert(n >= 1, 'cursor: service role reads cursors');
end $$;

-- 2) Authenticated cannot read.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from sync.cursor;
  perform public.rls_assert(n = 0, 'cursor: owner Alice cannot read cursors');
end $$;

-- 3) Authenticated cannot insert.
do $$
declare caught boolean := false;
begin
  begin
    insert into sync.cursor (connection_id, kind, value)
    values ('a0000014-0000-0000-0000-000000000000', 'x', 'y');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'cursor: authenticated cannot insert');
end $$;

select public.act_as_service();
