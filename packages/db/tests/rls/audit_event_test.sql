-- RLS: audit.event
--
-- Service-role only for both read and write in M1. A future SECURITY
-- INVOKER view may expose a filtered slice to household owners.

-- 1) Service role can read.
select public.act_as_service();
do $$
declare n int;
begin
  select count(*) into n from audit.event;
  perform public.rls_assert(n >= 1, 'audit.event: service role reads');
end $$;

-- 2) Authenticated (even owner) cannot read.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from audit.event;
  perform public.rls_assert(n = 0, 'audit.event: owner Alice cannot read');
end $$;

-- 3) Authenticated cannot insert.
do $$
declare caught boolean := false;
begin
  begin
    insert into audit.event (household_id, actor_user_id, action, resource_type)
    values ('aaaaaaa1-0000-0000-0000-000000000000',
            '11111111-1111-1111-1111-111111111111',
            'backdoor', 'x');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'audit.event: authenticated cannot insert');
end $$;

select public.act_as_service();
